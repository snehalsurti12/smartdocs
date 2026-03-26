/**
 * SmartDocsPayloadBuilder — Auto-generates JSON payload from multi-object field mapping config.
 *
 * Supports:
 * - Primary record fields (direct field access)
 * - Lookup traversal (Account.Owner.Name)
 * - Child relationships (Account → Opportunities, Contacts)
 * - Multiple data sources per template
 *
 * Customers never need to touch this class — it's driven entirely by the
 * point-and-click mapping UI.
 */
public with sharing class SmartDocsPayloadBuilder {

    /**
     * Build a complete data payload for a single record using multi-source mapping.
     * @param recordId - The Salesforce record to read data from
     * @param mappingId - SmartDocs_Template_Mapping__c record ID
     * @return Map<String, Object> ready to JSON.serialize for SmartDocs API
     */
    public static Map<String, Object> buildPayload(Id recordId, Id mappingId) {
        // Load mapping with all data sources and field maps
        SmartDocs_Template_Mapping__c mapping = [
            SELECT Id, Template_ID__c, Object_Type__c,
                (SELECT Id, Source_Type__c, Object_API_Name__c, Relationship_Name__c,
                        Relationship_Path__c, Template_Array_Path__c, Is_Primary__c,
                        Sort_Order__c, Filter_Condition__c
                 FROM SmartDocs_Data_Sources__r
                 ORDER BY Sort_Order__c NULLS LAST),
                (SELECT Id, Template_Field__c, SF_Field__c, Field_Type__c,
                        Is_Required__c, Is_Child_Relationship__c, Child_Object__c,
                        Child_Relationship__c, Data_Source__c
                 FROM SmartDocs_Field_Maps__r)
            FROM SmartDocs_Template_Mapping__c
            WHERE Id = :mappingId
            LIMIT 1
        ];

        Map<String, Object> payload = new Map<String, Object>();

        // If data sources are configured, use the new multi-source approach
        if (!mapping.SmartDocs_Data_Sources__r.isEmpty()) {
            return buildMultiSourcePayload(recordId, mapping);
        }

        // Fallback: legacy single-object approach (backward compatible)
        return buildLegacyPayload(recordId, mapping);
    }

    /**
     * Multi-source payload builder — uses SmartDocs_Data_Source__c records.
     */
    private static Map<String, Object> buildMultiSourcePayload(Id recordId, SmartDocs_Template_Mapping__c mapping) {
        Map<String, Object> payload = new Map<String, Object>();

        // Index field maps by data source ID
        Map<Id, List<SmartDocs_Field_Map__c>> fieldMapsBySource = new Map<Id, List<SmartDocs_Field_Map__c>>();
        List<SmartDocs_Field_Map__c> unmappedFields = new List<SmartDocs_Field_Map__c>();

        for (SmartDocs_Field_Map__c fm : mapping.SmartDocs_Field_Maps__r) {
            if (fm.Data_Source__c != null) {
                if (!fieldMapsBySource.containsKey(fm.Data_Source__c)) {
                    fieldMapsBySource.put(fm.Data_Source__c, new List<SmartDocs_Field_Map__c>());
                }
                fieldMapsBySource.get(fm.Data_Source__c).add(fm);
            } else {
                unmappedFields.add(fm);
            }
        }

        // Process each data source
        for (SmartDocs_Data_Source__c ds : mapping.SmartDocs_Data_Sources__r) {
            List<SmartDocs_Field_Map__c> sourceFields = fieldMapsBySource.get(ds.Id);
            if (sourceFields == null || sourceFields.isEmpty()) continue;

            if (ds.Source_Type__c == 'primary' || ds.Is_Primary__c) {
                // Primary source: query the starting record directly
                processPrimarySource(recordId, ds, sourceFields, payload);
            } else if (ds.Source_Type__c == 'child_relationship') {
                // Child relationship: query related records as an array
                processChildSource(recordId, ds, sourceFields, mapping.Object_Type__c, payload);
            } else if (ds.Source_Type__c == 'lookup') {
                // Lookup traversal: navigate through lookup relationships
                processLookupSource(recordId, ds, sourceFields, mapping.Object_Type__c, payload);
            }
        }

        // Process any unmapped fields using the primary object
        if (!unmappedFields.isEmpty()) {
            processPrimaryFields(recordId, mapping.Object_Type__c, unmappedFields, payload);
        }

        return payload;
    }

    /**
     * Process primary source — direct fields on the starting record.
     */
    private static void processPrimarySource(Id recordId, SmartDocs_Data_Source__c ds,
            List<SmartDocs_Field_Map__c> fieldMaps, Map<String, Object> payload) {
        String objectType = ds.Object_API_Name__c;
        Set<String> sfFields = new Set<String>{'Id'};
        for (SmartDocs_Field_Map__c fm : fieldMaps) {
            if (String.isNotBlank(fm.SF_Field__c)) sfFields.add(fm.SF_Field__c);
        }

        String soql = 'SELECT ' + String.join(new List<String>(sfFields), ', ') +
                       ' FROM ' + String.escapeSingleQuotes(objectType) +
                       ' WHERE Id = :recordId LIMIT 1';
        SObject record = Database.query(soql);

        for (SmartDocs_Field_Map__c fm : fieldMaps) {
            Object value = getFieldValue(record, fm.SF_Field__c);
            setNestedValue(payload, fm.Template_Field__c, value);
        }
    }

    /**
     * Process child relationship source — query related records as an array.
     */
    private static void processChildSource(Id recordId, SmartDocs_Data_Source__c ds,
            List<SmartDocs_Field_Map__c> fieldMaps, String parentObjectType, Map<String, Object> payload) {
        String childObject = ds.Object_API_Name__c;
        String relationship = ds.Relationship_Name__c;
        String arrayPath = ds.Template_Array_Path__c;

        Set<String> childSfFields = new Set<String>{'Id'};
        for (SmartDocs_Field_Map__c fm : fieldMaps) {
            if (String.isNotBlank(fm.SF_Field__c)) childSfFields.add(fm.SF_Field__c);
        }

        // Build sub-query through the parent
        String soql = 'SELECT (SELECT ' + String.join(new List<String>(childSfFields), ', ') +
                       ' FROM ' + String.escapeSingleQuotes(relationship);
        if (String.isNotBlank(ds.Filter_Condition__c)) {
            soql += ' WHERE ' + ds.Filter_Condition__c;
        }
        soql += ') FROM ' + String.escapeSingleQuotes(parentObjectType) +
                ' WHERE Id = :recordId LIMIT 1';

        SObject parentRecord = Database.query(soql);
        List<SObject> children = parentRecord.getSObjects(relationship);

        List<Map<String, Object>> childList = new List<Map<String, Object>>();
        if (children != null) {
            for (SObject child : children) {
                Map<String, Object> childData = new Map<String, Object>();
                for (SmartDocs_Field_Map__c fm : fieldMaps) {
                    Object value = getFieldValue(child, fm.SF_Field__c);
                    String fieldName = fm.Template_Field__c;
                    // Strip array prefix (e.g. "items.name" → "name")
                    if (fieldName.contains('.')) {
                        fieldName = fieldName.substringAfter('.');
                    }
                    childData.put(fieldName, value);
                }
                childList.add(childData);
            }
        }

        if (String.isNotBlank(arrayPath)) {
            setNestedValue(payload, arrayPath, childList);
        }
    }

    /**
     * Process lookup source — traverse lookup relationships from the starting record.
     */
    private static void processLookupSource(Id recordId, SmartDocs_Data_Source__c ds,
            List<SmartDocs_Field_Map__c> fieldMaps, String parentObjectType, Map<String, Object> payload) {
        String relationshipPath = ds.Relationship_Path__c; // e.g. "Owner" or "Account.Owner"

        Set<String> sfFields = new Set<String>();
        for (SmartDocs_Field_Map__c fm : fieldMaps) {
            if (String.isNotBlank(fm.SF_Field__c)) {
                // Prepend relationship path: "Owner" + "Name" → "Owner.Name"
                sfFields.add(relationshipPath + '.' + fm.SF_Field__c);
            }
        }

        String soql = 'SELECT ' + String.join(new List<String>(sfFields), ', ') +
                       ' FROM ' + String.escapeSingleQuotes(parentObjectType) +
                       ' WHERE Id = :recordId LIMIT 1';
        SObject record = Database.query(soql);

        for (SmartDocs_Field_Map__c fm : fieldMaps) {
            String fullPath = relationshipPath + '.' + fm.SF_Field__c;
            Object value = getFieldValue(record, fullPath);
            setNestedValue(payload, fm.Template_Field__c, value);
        }
    }

    /**
     * Process fields without a data source assignment (fallback to primary object).
     */
    private static void processPrimaryFields(Id recordId, String objectType,
            List<SmartDocs_Field_Map__c> fieldMaps, Map<String, Object> payload) {
        Set<String> sfFields = new Set<String>{'Id'};
        List<SmartDocs_Field_Map__c> parentFields = new List<SmartDocs_Field_Map__c>();
        List<SmartDocs_Field_Map__c> childFields = new List<SmartDocs_Field_Map__c>();

        for (SmartDocs_Field_Map__c fm : fieldMaps) {
            if (fm.Is_Child_Relationship__c && String.isNotBlank(fm.Child_Relationship__c)) {
                childFields.add(fm);
            } else {
                parentFields.add(fm);
                if (String.isNotBlank(fm.SF_Field__c)) sfFields.add(fm.SF_Field__c);
            }
        }

        // Build child sub-queries
        Map<String, List<SmartDocs_Field_Map__c>> childGrouped = new Map<String, List<SmartDocs_Field_Map__c>>();
        for (SmartDocs_Field_Map__c fm : childFields) {
            String rel = fm.Child_Relationship__c;
            if (!childGrouped.containsKey(rel)) childGrouped.put(rel, new List<SmartDocs_Field_Map__c>());
            childGrouped.get(rel).add(fm);
        }

        String subQueries = '';
        for (String rel : childGrouped.keySet()) {
            Set<String> childSfFields = new Set<String>{'Id'};
            for (SmartDocs_Field_Map__c fm : childGrouped.get(rel)) {
                if (String.isNotBlank(fm.SF_Field__c)) childSfFields.add(fm.SF_Field__c);
            }
            subQueries += ', (SELECT ' + String.join(new List<String>(childSfFields), ', ') + ' FROM ' + rel + ')';
        }

        String soql = 'SELECT ' + String.join(new List<String>(sfFields), ', ') + subQueries +
                       ' FROM ' + String.escapeSingleQuotes(objectType) + ' WHERE Id = :recordId LIMIT 1';
        SObject record = Database.query(soql);

        for (SmartDocs_Field_Map__c fm : parentFields) {
            Object value = getFieldValue(record, fm.SF_Field__c);
            setNestedValue(payload, fm.Template_Field__c, value);
        }

        for (String rel : childGrouped.keySet()) {
            List<SmartDocs_Field_Map__c> relFields = childGrouped.get(rel);
            List<SObject> children = record.getSObjects(rel);
            List<Map<String, Object>> childList = new List<Map<String, Object>>();
            if (children != null) {
                for (SObject child : children) {
                    Map<String, Object> childData = new Map<String, Object>();
                    for (SmartDocs_Field_Map__c fm : relFields) {
                        Object value = getFieldValue(child, fm.SF_Field__c);
                        String fieldName = fm.Template_Field__c;
                        if (fieldName.contains('.')) fieldName = fieldName.substringAfter('.');
                        childData.put(fieldName, value);
                    }
                    childList.add(childData);
                }
            }
            if (!relFields.isEmpty()) {
                String firstPath = relFields[0].Template_Field__c;
                String arrPath = firstPath.contains('.') ? firstPath.substringBefore('.') : firstPath;
                setNestedValue(payload, arrPath, childList);
            }
        }
    }

    /**
     * Legacy single-object payload builder (backward compatible).
     */
    private static Map<String, Object> buildLegacyPayload(Id recordId, SmartDocs_Template_Mapping__c mapping) {
        Map<String, Object> payload = new Map<String, Object>();
        processPrimaryFields(recordId, mapping.Object_Type__c, mapping.SmartDocs_Field_Maps__r, payload);
        return payload;
    }

    /**
     * Get a field value from an SObject, handling relationship traversal.
     * Supports paths like "Name", "Account.Name", "Account.Owner.Name"
     */
    private static Object getFieldValue(SObject record, String fieldPath) {
        if (record == null || String.isBlank(fieldPath)) return null;
        if (!fieldPath.contains('.')) {
            try { return record.get(fieldPath); } catch (Exception e) { return null; }
        }
        String[] parts = fieldPath.split('\\.');
        SObject current = record;
        for (Integer i = 0; i < parts.size() - 1; i++) {
            current = current.getSObject(parts[i]);
            if (current == null) return null;
        }
        try { return current.get(parts[parts.size() - 1]); } catch (Exception e) { return null; }
    }

    /**
     * Set a value in a nested map using dot-path notation.
     */
    private static void setNestedValue(Map<String, Object> root, String path, Object value) {
        if (String.isBlank(path) || value == null) return;
        String[] parts = path.split('\\.');
        Map<String, Object> current = root;
        for (Integer i = 0; i < parts.size() - 1; i++) {
            String part = parts[i];
            if (!current.containsKey(part) || !(current.get(part) instanceof Map<String, Object>)) {
                current.put(part, new Map<String, Object>());
            }
            current = (Map<String, Object>) current.get(part);
        }
        current.put(parts[parts.size() - 1], value);
    }
}
