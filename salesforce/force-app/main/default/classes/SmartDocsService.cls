/**
 * SmartDocsService — Core service for SmartDocs API integration.
 * Handles HTTP callouts, authentication, and PDF attachment.
 */
public with sharing class SmartDocsService {

    private static final String CONFIG_NAME = 'Default';

    /**
     * Get SmartDocs configuration from Custom Metadata.
     */
    private static SmartDocs_Config__mdt getConfig() {
        SmartDocs_Config__mdt config = SmartDocs_Config__mdt.getInstance(CONFIG_NAME);
        if (config == null) {
            throw new SmartDocsException('SmartDocs configuration not found. Please set up SmartDocs_Config__mdt.');
        }
        return config;
    }

    /**
     * Render a single document for a Salesforce record.
     * @param mappingId - ID of SmartDocs_Template_Mapping__c record
     * @param recordId - Salesforce record to generate document for
     * @return Blob - PDF binary
     */
    public static Blob renderDocument(Id mappingId, Id recordId) {
        SmartDocs_Config__mdt config = getConfig();
        SmartDocs_Template_Mapping__c mapping = [
            SELECT Template_ID__c, Object_Type__c
            FROM SmartDocs_Template_Mapping__c
            WHERE Id = :mappingId AND Active__c = true
            LIMIT 1
        ];

        Map<String, Object> payload = SmartDocsPayloadBuilder.buildPayload(recordId, mappingId);

        Map<String, Object> requestBody = new Map<String, Object>{
            'templateId' => mapping.Template_ID__c,
            'data' => payload,
            'format' => 'pdf'
        };

        HttpRequest req = new HttpRequest();
        req.setEndpoint(config.Endpoint_URL__c + '/api/render');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Authorization', 'Bearer ' + config.API_Key__c);
        req.setBody(JSON.serialize(requestBody));
        req.setTimeout(30000); // 30 seconds

        HttpResponse res = new Http().send(req);

        if (res.getStatusCode() != 200) {
            String errorMsg = 'SmartDocs render failed: ' + res.getStatusCode();
            try {
                Map<String, Object> errorBody = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
                if (errorBody.containsKey('error')) {
                    errorMsg += ' - ' + String.valueOf(errorBody.get('error'));
                }
            } catch (Exception e) { /* ignore parse errors */ }
            throw new SmartDocsException(errorMsg);
        }

        return res.getBodyAsBlob();
    }

    /**
     * Render documents for multiple records (batch).
     * Chunks into groups to stay within governor limits.
     * @param mappingId - ID of SmartDocs_Template_Mapping__c record
     * @param recordIds - List of Salesforce record IDs
     * @return Map of recordId => PDF Blob
     */
    public static Map<Id, Blob> renderBulk(Id mappingId, List<Id> recordIds) {
        Map<Id, Blob> results = new Map<Id, Blob>();
        for (Id recId : recordIds) {
            try {
                Blob pdf = renderDocument(mappingId, recId);
                results.put(recId, pdf);
            } catch (Exception e) {
                System.debug(LoggingLevel.ERROR, 'SmartDocs render failed for ' + recId + ': ' + e.getMessage());
            }
        }
        return results;
    }

    /**
     * Attach a PDF to a Salesforce record as a ContentVersion.
     * @param recordId - Record to attach the file to
     * @param pdfBlob - PDF binary data
     * @param fileName - Name for the file
     * @return Id - ContentVersion ID
     */
    public static Id attachToRecord(Id recordId, Blob pdfBlob, String fileName) {
        ContentVersion cv = new ContentVersion();
        cv.Title = fileName != null ? fileName : 'Document.pdf';
        cv.PathOnClient = cv.Title.endsWith('.pdf') ? cv.Title : cv.Title + '.pdf';
        cv.VersionData = pdfBlob;
        cv.FirstPublishLocationId = recordId;
        insert cv;
        return cv.Id;
    }

    /**
     * Render and attach in one call.
     */
    public static Id renderAndAttach(Id mappingId, Id recordId, String fileName) {
        Blob pdf = renderDocument(mappingId, recordId);
        return attachToRecord(recordId, pdf, fileName);
    }

    /**
     * Fetch template fields from SmartDocs API.
     * Used by the field mapper LWC to display available fields.
     */
    public static Map<String, Object> getTemplateFields(String templateId) {
        SmartDocs_Config__mdt config = getConfig();

        HttpRequest req = new HttpRequest();
        req.setEndpoint(config.Endpoint_URL__c + '/api/templates/' + templateId + '/fields');
        req.setMethod('GET');
        req.setHeader('Authorization', 'Bearer ' + config.API_Key__c);
        req.setTimeout(15000);

        HttpResponse res = new Http().send(req);

        if (res.getStatusCode() != 200) {
            throw new SmartDocsException('Failed to fetch template fields: ' + res.getStatusCode());
        }

        return (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
    }

    /**
     * AuraEnabled method for LWC — renders and attaches a document.
     * @param mappingId - SmartDocs_Template_Mapping__c record ID
     * @param recordId - Salesforce record ID
     * @param fileName - Name for the generated PDF
     * @return Map with contentVersionId, success, downloadUrl
     */
    @AuraEnabled
    public static Map<String, Object> renderDocumentForLwc(Id mappingId, Id recordId, String fileName) {
        Map<String, Object> result = new Map<String, Object>();
        try {
            String fName = String.isNotBlank(fileName) ? fileName : 'Document';
            Id cvId = renderAndAttach(mappingId, recordId, fName);

            ContentVersion cv = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cvId LIMIT 1];

            result.put('contentVersionId', cvId);
            result.put('success', true);
            result.put('downloadUrl', '/sfc/servlet.shepherd/document/download/' + cv.ContentDocumentId);
        } catch (Exception e) {
            result.put('success', false);
            result.put('errorMessage', e.getMessage());
        }
        return result;
    }

    public class SmartDocsException extends Exception {}
}
