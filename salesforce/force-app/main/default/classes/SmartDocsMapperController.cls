/**
 * SmartDocsMapperController — Apex controller for the field mapper LWC.
 * Provides object/field metadata and manages mapping CRUD.
 */
public with sharing class SmartDocsMapperController {

    /**
     * List all templates from SmartDocs API.
     */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> listTemplates() {
        SmartDocs_Config__mdt config = SmartDocs_Config__mdt.getInstance('Default');
        if (config == null) throw new AuraHandledException('SmartDocs not configured.');

        HttpRequest req = new HttpRequest();
        req.setEndpoint(config.Endpoint_URL__c + '/api/templates');
        req.setMethod('GET');
        req.setHeader('Authorization', 'Bearer ' + config.API_Key__c);
        req.setTimeout(15000);

        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) {
            throw new AuraHandledException('Failed to fetch templates: ' + res.getStatusCode());
        }

        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        List<Object> rawTemplates = (List<Object>) body.get('templates');
        List<Map<String, Object>> result = new List<Map<String, Object>>();
        if (rawTemplates != null) {
            for (Object t : rawTemplates) {
                Map<String, Object> tmpl = (Map<String, Object>) t;
                Map<String, Object> item = new Map<String, Object>();
                item.put('id', tmpl.get('id'));
                item.put('name', tmpl.get('name'));
                item.put('status', tmpl.get('status'));
                item.put('description', tmpl.get('description'));
                result.add(item);
            }
        }
        return result;
    }

    /**
     * Fetch template fields from SmartDocs API.
     */
    @AuraEnabled(cacheable=true)
    public static Map<String, Object> getTemplateFields(String templateId) {
        return SmartDocsService.getTemplateFields(templateId);
    }

    /**
     * Get fields for a Salesforce object.
     */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getObjectFields(String objectApiName) {
        List<Map<String, String>> result = new List<Map<String, String>>();
        if (String.isBlank(objectApiName)) return result;

        Schema.SObjectType sot = Schema.getGlobalDescribe().get(objectApiName);
        if (sot == null) return result;

        Map<String, Schema.SObjectField> fieldMap = sot.getDescribe().fields.getMap();
        for (String fieldName : fieldMap.keySet()) {
            Schema.DescribeFieldResult dfr = fieldMap.get(fieldName).getDescribe();
            if (!dfr.isAccessible()) continue;

            Map<String, String> fieldInfo = new Map<String, String>();
            fieldInfo.put('apiName', dfr.getName());
            fieldInfo.put('label', dfr.getLabel());
            fieldInfo.put('type', String.valueOf(dfr.getType()));
            fieldInfo.put('relationshipName', dfr.getRelationshipName());

            // For lookup/master-detail fields, include the referenced object
            List<Schema.SObjectType> refs = dfr.getReferenceTo();
            if (!refs.isEmpty()) {
                fieldInfo.put('referenceTo', refs[0].getDescribe().getName());
            }

            result.add(fieldInfo);
        }

        return result;
    }

    /**
     * Get child relationships for a Salesforce object.
     */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getChildRelationships(String objectApiName) {
        List<Map<String, String>> result = new List<Map<String, String>>();
        if (String.isBlank(objectApiName)) return result;

        Schema.SObjectType sot = Schema.getGlobalDescribe().get(objectApiName);
        if (sot == null) return result;

        for (Schema.ChildRelationship cr : sot.getDescribe().getChildRelationships()) {
            if (cr.getRelationshipName() == null) continue;

            Map<String, String> relInfo = new Map<String, String>();
            relInfo.put('relationshipName', cr.getRelationshipName());
            relInfo.put('childObject', cr.getChildSObject().getDescribe().getName());
            relInfo.put('childObjectLabel', cr.getChildSObject().getDescribe().getLabel());
            relInfo.put('field', cr.getField().getDescribe().getName());
            result.add(relInfo);
        }

        return result;
    }

    /**
     * Get active mappings for a specific object type.
     * Used by the Generator LWC to show available templates.
     */
    @AuraEnabled(cacheable=true)
    public static List<SmartDocs_Template_Mapping__c> getActiveMappings(String objectApiName) {
        return [
            SELECT Id, Template_ID__c, Template_Name__c, Object_Type__c
            FROM SmartDocs_Template_Mapping__c
            WHERE Active__c = true
            AND Object_Type__c = :objectApiName
            ORDER BY Template_Name__c
        ];
    }

    /**
     * Get all active mappings (for any object type).
     */
    @AuraEnabled(cacheable=true)
    public static List<SmartDocs_Template_Mapping__c> getAllActiveMappings() {
        return [
            SELECT Id, Template_ID__c, Template_Name__c, Object_Type__c
            FROM SmartDocs_Template_Mapping__c
            WHERE Active__c = true
            ORDER BY Object_Type__c, Template_Name__c
        ];
    }

    /**
     * Get common Salesforce objects for the object picker.
     */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getAvailableObjects() {
        List<Map<String, String>> result = new List<Map<String, String>>();
        Map<String, Schema.SObjectType> globalDescribe = Schema.getGlobalDescribe();

        for (String objName : globalDescribe.keySet()) {
            Schema.DescribeSObjectResult dsr = globalDescribe.get(objName).getDescribe();
            if (!dsr.isAccessible() || !dsr.isQueryable()) continue;
            if (dsr.getName().endsWith('__History') || dsr.getName().endsWith('__Feed') ||
                dsr.getName().endsWith('__Share') || dsr.getName().endsWith('__Tag')) continue;

            Map<String, String> objInfo = new Map<String, String>();
            objInfo.put('apiName', dsr.getName());
            objInfo.put('label', dsr.getLabel());
            objInfo.put('isCustom', String.valueOf(dsr.isCustom()));
            result.add(objInfo);
        }

        return result;
    }

    /**
     * Load existing mapping for a template.
     */
    @AuraEnabled
    public static Map<String, Object> loadMapping(Id mappingId) {
        SmartDocs_Template_Mapping__c mapping = [
            SELECT Id, Template_ID__c, Template_Name__c, Object_Type__c, Active__c,
                (SELECT Id, Source_Type__c, Object_API_Name__c, Relationship_Name__c,
                        Relationship_Path__c, Template_Array_Path__c, Is_Primary__c,
                        Sort_Order__c, Filter_Condition__c
                 FROM SmartDocs_Data_Sources__r ORDER BY Sort_Order__c NULLS LAST),
                (SELECT Id, Template_Field__c, SF_Field__c, Field_Type__c,
                        Is_Required__c, Is_Child_Relationship__c, Child_Object__c,
                        Child_Relationship__c, Data_Source__c
                 FROM SmartDocs_Field_Maps__r)
            FROM SmartDocs_Template_Mapping__c
            WHERE Id = :mappingId
            LIMIT 1
        ];

        Map<String, Object> result = new Map<String, Object>();
        result.put('mapping', mapping);
        result.put('dataSources', mapping.SmartDocs_Data_Sources__r);
        result.put('fieldMaps', mapping.SmartDocs_Field_Maps__r);
        return result;
    }

    /**
     * Save a complete mapping configuration.
     */
    @AuraEnabled
    public static Id saveMapping(String mappingJson) {
        Map<String, Object> data = (Map<String, Object>) JSON.deserializeUntyped(mappingJson);

        // Upsert mapping record
        String mappingId = (String) data.get('mappingId');
        String templateId = (String) data.get('templateId');
        String templateName = (String) data.get('templateName');
        String objectType = (String) data.get('objectType');

        SmartDocs_Template_Mapping__c mapping;
        if (String.isNotBlank(mappingId)) {
            mapping = [SELECT Id FROM SmartDocs_Template_Mapping__c WHERE Id = :mappingId LIMIT 1];
            mapping.Template_ID__c = templateId;
            mapping.Template_Name__c = templateName;
            mapping.Object_Type__c = objectType;
            mapping.Active__c = true;
            update mapping;
        } else {
            mapping = new SmartDocs_Template_Mapping__c(
                Template_ID__c = templateId,
                Template_Name__c = templateName,
                Object_Type__c = objectType,
                Active__c = true
            );
            insert mapping;
        }

        // Delete existing data sources and field maps (replace strategy)
        delete [SELECT Id FROM SmartDocs_Data_Source__c WHERE SmartDocs_Template_Mapping__c = :mapping.Id];
        delete [SELECT Id FROM SmartDocs_Field_Map__c WHERE SmartDocs_Template_Mapping__c = :mapping.Id];

        // Create data sources
        List<Object> sourcesRaw = (List<Object>) data.get('dataSources');
        Map<String, Id> sourceIdMap = new Map<String, Id>(); // tempId → real Id
        if (sourcesRaw != null) {
            List<SmartDocs_Data_Source__c> sources = new List<SmartDocs_Data_Source__c>();
            Integer sortIdx = 0;
            for (Object srcObj : sourcesRaw) {
                Map<String, Object> src = (Map<String, Object>) srcObj;
                SmartDocs_Data_Source__c ds = new SmartDocs_Data_Source__c(
                    SmartDocs_Template_Mapping__c = mapping.Id,
                    Source_Type__c = (String) src.get('sourceType'),
                    Object_API_Name__c = (String) src.get('objectApiName'),
                    Relationship_Name__c = (String) src.get('relationshipName'),
                    Relationship_Path__c = (String) src.get('relationshipPath'),
                    Template_Array_Path__c = (String) src.get('templateArrayPath'),
                    Is_Primary__c = Boolean.valueOf(src.get('isPrimary')),
                    Sort_Order__c = sortIdx++,
                    Filter_Condition__c = (String) src.get('filterCondition')
                );
                sources.add(ds);
            }
            insert sources;
            // Map temp IDs
            for (Integer i = 0; i < sourcesRaw.size(); i++) {
                Map<String, Object> src = (Map<String, Object>) sourcesRaw[i];
                String tempId = (String) src.get('tempId');
                if (String.isNotBlank(tempId)) {
                    sourceIdMap.put(tempId, sources[i].Id);
                }
            }
        }

        // Create field maps
        List<Object> fieldsRaw = (List<Object>) data.get('fieldMaps');
        if (fieldsRaw != null) {
            List<SmartDocs_Field_Map__c> fieldMaps = new List<SmartDocs_Field_Map__c>();
            for (Object fObj : fieldsRaw) {
                Map<String, Object> f = (Map<String, Object>) fObj;
                String dsRef = (String) f.get('dataSourceTempId');
                Id dsId = String.isNotBlank(dsRef) ? sourceIdMap.get(dsRef) : null;

                fieldMaps.add(new SmartDocs_Field_Map__c(
                    SmartDocs_Template_Mapping__c = mapping.Id,
                    Template_Field__c = (String) f.get('templateField'),
                    SF_Field__c = (String) f.get('sfField'),
                    Field_Type__c = (String) f.get('fieldType'),
                    Is_Required__c = Boolean.valueOf(f.get('isRequired')),
                    Is_Child_Relationship__c = Boolean.valueOf(f.get('isChildRelationship')),
                    Child_Object__c = (String) f.get('childObject'),
                    Child_Relationship__c = (String) f.get('childRelationship'),
                    Data_Source__c = dsId
                ));
            }
            insert fieldMaps;
        }

        return mapping.Id;
    }
}
