/**
 * SmartDocsPayloadBuilder — Auto-generates JSON payload from field mapping config.
 * Reads SmartDocs_Template_Mapping__c + SmartDocs_Field_Map__c records,
 * builds dynamic SOQL, queries the record, and transforms to nested JSON.
 *
 * Customers never need to touch this class — it's driven entirely by the
 * point-and-click mapping UI (smartDocsFieldMapper LWC).
 */
public with sharing class SmartDocsPayloadBuilder {

    /**
     * Build a complete data payload for a single record.
     * @param recordId - The Salesforce record to read data from
     * @param mappingId - SmartDocs_Template_Mapping__c record ID
     * @return Map<String, Object> ready to JSON.serialize for SmartDocs API
     */
    public static Map<String, Object> buildPayload(Id recordId, Id mappingId) {
        SmartDocs_Template_Mapping__c mapping = [
            SELECT Id, Template_ID__c, Object_Type__c,
                (SELECT Template_Field__c, SF_Field__c, Field_Type__c,
                        Is_Child_Relationship__c, Child_Object__c, Child_Relationship__c
                 FROM SmartDocs_Field_Maps__r)
            FROM SmartDocs_Template_Mapping__c
            WHERE Id = :mappingId
            LIMIT 1
        ];

        // Separate parent fields from child relationship fields
        List<SmartDocs_Field_Map__c> parentFields = new List<SmartDocs_Field_Map__c>();
        List<SmartDocs_Field_Map__c> childFields = new List<SmartDocs_Field_Map__c>();

        for (SmartDocs_Field_Map__c fm : mapping.SmartDocs_Field_Maps__r) {
            if (fm.Is_Child_Relationship__c && String.isNotBlank(fm.Child_Relationship__c)) {
                childFields.add(fm);
            } else {
                parentFields.add(fm);
            }
        }

        // Build dynamic SOQL for parent record
        Set<String> sfFields = new Set<String>{'Id'};
        for (SmartDocs_Field_Map__c fm : parentFields) {
            if (String.isNotBlank(fm.SF_Field__c)) {
                sfFields.add(fm.SF_Field__c);
            }
        }

        // Build child relationship sub-queries
        Map<String, List<SmartDocs_Field_Map__c>> childGrouped = new Map<String, List<SmartDocs_Field_Map__c>>();
        for (SmartDocs_Field_Map__c fm : childFields) {
            String rel = fm.Child_Relationship__c;
            if (!childGrouped.containsKey(rel)) {
                childGrouped.put(rel, new List<SmartDocs_Field_Map__c>());
            }
            childGrouped.get(rel).add(fm);
        }

        String subQueries = '';
        for (String rel : childGrouped.keySet()) {
            Set<String> childSfFields = new Set<String>{'Id'};
            for (SmartDocs_Field_Map__c fm : childGrouped.get(rel)) {
                if (String.isNotBlank(fm.SF_Field__c)) {
                    childSfFields.add(fm.SF_Field__c);
                }
            }
            subQueries += ', (SELECT ' + String.join(new List<String>(childSfFields), ', ') +
                          ' FROM ' + rel + ')';
        }

        String soql = 'SELECT ' + String.join(new List<String>(sfFields), ', ') +
                       subQueries +
                       ' FROM ' + mapping.Object_Type__c +
                       ' WHERE Id = :recordId LIMIT 1';

        SObject record = Database.query(soql);

        // Build nested payload from parent fields
        Map<String, Object> payload = new Map<String, Object>();
        for (SmartDocs_Field_Map__c fm : parentFields) {
            Object value = getFieldValue(record, fm.SF_Field__c);
            setNestedValue(payload, fm.Template_Field__c, value);
        }

        // Build child arrays
        for (String rel : childGrouped.keySet()) {
            List<SmartDocs_Field_Map__c> relFields = childGrouped.get(rel);
            // Find the template field path for this array (use first child's parent path)
            String arrayPath = null;
            for (SmartDocs_Field_Map__c fm : relFields) {
                String tf = fm.Template_Field__c;
                if (tf.contains('.')) {
                    // For "transactions.client", the array path is "transactions"
                    // The actual field mapping uses the part after the dot
                } else {
                    arrayPath = tf;
                }
            }

            List<SObject> children = record.getSObjects(rel);
            List<Map<String, Object>> childList = new List<Map<String, Object>>();
            if (children != null) {
                for (SObject child : children) {
                    Map<String, Object> childData = new Map<String, Object>();
                    for (SmartDocs_Field_Map__c fm : relFields) {
                        Object value = getFieldValue(child, fm.SF_Field__c);
                        String fieldName = fm.Template_Field__c;
                        // Strip array prefix if present (e.g. "transactions.client" → "client")
                        if (fieldName.contains('.')) {
                            fieldName = fieldName.substringAfter('.');
                        }
                        childData.put(fieldName, value);
                    }
                    childList.add(childData);
                }
            }

            // Find which template path holds this array
            if (arrayPath != null) {
                setNestedValue(payload, arrayPath, childList);
            } else if (!relFields.isEmpty()) {
                // Use first field's path prefix
                String firstPath = relFields[0].Template_Field__c;
                if (firstPath.contains('.')) {
                    setNestedValue(payload, firstPath.substringBefore('.'), childList);
                }
            }
        }

        return payload;
    }

    /**
     * Get a field value from an SObject, handling relationship traversal.
     */
    private static Object getFieldValue(SObject record, String fieldPath) {
        if (record == null || String.isBlank(fieldPath)) return null;

        if (!fieldPath.contains('.')) {
            try {
                return record.get(fieldPath);
            } catch (Exception e) {
                return null;
            }
        }

        // Traverse relationship (e.g. "Account.Name")
        String[] parts = fieldPath.split('\\.');
        SObject current = record;
        for (Integer i = 0; i < parts.size() - 1; i++) {
            current = current.getSObject(parts[i]);
            if (current == null) return null;
        }
        try {
            return current.get(parts[parts.size() - 1]);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Set a value in a nested map using dot-path notation.
     * e.g. setNestedValue(map, "company.name", "Acme") creates { "company": { "name": "Acme" } }
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
