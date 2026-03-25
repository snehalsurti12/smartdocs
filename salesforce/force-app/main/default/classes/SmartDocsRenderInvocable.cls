/**
 * SmartDocsRenderInvocable — Invocable Apex for Flow Builder and Agentforce.
 *
 * Admins can use this in:
 * - Screen Flows: "Generate Document" button in a flow
 * - Record-Triggered Flows: auto-generate on record create/update
 * - Agentforce Topics: AI agent action for document generation
 *
 * No Apex coding required by customers.
 */
public with sharing class SmartDocsRenderInvocable {

    public class RenderRequest {
        @InvocableVariable(label='Mapping ID' description='SmartDocs Template Mapping record ID' required=true)
        public Id mappingId;

        @InvocableVariable(label='Record ID' description='The Salesforce record to generate the document for' required=true)
        public Id recordId;

        @InvocableVariable(label='File Name' description='Name for the generated PDF file (optional, defaults to template name)' required=false)
        public String fileName;
    }

    public class RenderResult {
        @InvocableVariable(label='Content Version ID' description='ID of the generated PDF file record')
        public Id contentVersionId;

        @InvocableVariable(label='Success' description='Whether the document was generated successfully')
        public Boolean success;

        @InvocableVariable(label='Error Message' description='Error details if generation failed')
        public String errorMessage;

        @InvocableVariable(label='Download URL' description='URL to download the generated document')
        public String downloadUrl;
    }

    @InvocableMethod(
        label='Generate SmartDocs Document'
        description='Generates a PDF document from a SmartDocs template using Salesforce record data. The document is automatically attached to the record. Configure templates and field mappings in SmartDocs Setup.'
    )
    public static List<RenderResult> renderDocuments(List<RenderRequest> requests) {
        List<RenderResult> results = new List<RenderResult>();

        for (RenderRequest req : requests) {
            RenderResult result = new RenderResult();
            try {
                String fName = String.isNotBlank(req.fileName) ? req.fileName : getDefaultFileName(req.mappingId);
                Id cvId = SmartDocsService.renderAndAttach(req.mappingId, req.recordId, fName);

                result.contentVersionId = cvId;
                result.success = true;

                // Build download URL
                ContentVersion cv = [SELECT ContentDocumentId FROM ContentVersion WHERE Id = :cvId LIMIT 1];
                result.downloadUrl = '/sfc/servlet.shepherd/document/download/' + cv.ContentDocumentId;

            } catch (Exception e) {
                result.success = false;
                result.errorMessage = e.getMessage();
            }
            results.add(result);
        }

        return results;
    }

    private static String getDefaultFileName(Id mappingId) {
        try {
            SmartDocs_Template_Mapping__c mapping = [
                SELECT Template_Name__c FROM SmartDocs_Template_Mapping__c WHERE Id = :mappingId LIMIT 1
            ];
            return mapping.Template_Name__c != null ? mapping.Template_Name__c + '.pdf' : 'Document.pdf';
        } catch (Exception e) {
            return 'Document.pdf';
        }
    }
}
