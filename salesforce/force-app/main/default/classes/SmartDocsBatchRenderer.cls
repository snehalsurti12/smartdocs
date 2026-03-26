/**
 * SmartDocsBatchRenderer — Batch Apex for mass document generation.
 *
 * Usage:
 *   Id mappingId = '...'; // SmartDocs_Template_Mapping__c ID
 *   String query = 'SELECT Id FROM Account WHERE Type = \'Customer\'';
 *   SmartDocsBatchRenderer batch = new SmartDocsBatchRenderer(mappingId, 'Invoice');
 *   Database.executeBatch(batch, 10); // 10 records per batch (callout limit friendly)
 */
global with sharing class SmartDocsBatchRenderer implements Database.Batchable<SObject>, Database.AllowsCallouts, Database.Stateful {

    private Id mappingId;
    private String fileName;
    private String objectType;
    private String whereClause;

    // Stateful tracking
    global Integer totalProcessed = 0;
    global Integer totalSucceeded = 0;
    global Integer totalFailed = 0;
    global List<String> errors = new List<String>();

    global SmartDocsBatchRenderer(Id mappingId, String fileName) {
        this.mappingId = mappingId;
        this.fileName = fileName;

        SmartDocs_Template_Mapping__c mapping = [
            SELECT Object_Type__c FROM SmartDocs_Template_Mapping__c WHERE Id = :mappingId LIMIT 1
        ];
        this.objectType = mapping.Object_Type__c;
    }

    global SmartDocsBatchRenderer(Id mappingId, String fileName, String whereClause) {
        this(mappingId, fileName);
        this.whereClause = whereClause;
    }

    global Database.QueryLocator start(Database.BatchableContext bc) {
        String soql = 'SELECT Id FROM ' + String.escapeSingleQuotes(objectType);
        if (String.isNotBlank(whereClause)) {
            soql += ' WHERE ' + whereClause;
        }
        return Database.getQueryLocator(soql);
    }

    global void execute(Database.BatchableContext bc, List<SObject> scope) {
        // Phase 1: Render all PDFs (callouts) — no DML yet
        List<Blob> pdfs = new List<Blob>();
        List<Id> recordIds = new List<Id>();
        List<String> fileNames = new List<String>();

        for (SObject record : scope) {
            totalProcessed++;
            try {
                String fName = fileName != null ? fileName + ' - ' + record.Id + '.pdf' : record.Id + '.pdf';
                Blob pdf = SmartDocsService.renderDocument(mappingId, record.Id);
                pdfs.add(pdf);
                recordIds.add(record.Id);
                fileNames.add(fName);
                totalSucceeded++;
            } catch (Exception e) {
                totalFailed++;
                if (errors.size() < 100) {
                    errors.add(record.Id + ': ' + e.getMessage());
                }
            }
        }

        // Phase 2: Attach all PDFs (DML) — after all callouts complete
        List<ContentVersion> cvs = new List<ContentVersion>();
        for (Integer i = 0; i < pdfs.size(); i++) {
            ContentVersion cv = new ContentVersion();
            cv.Title = fileNames[i];
            cv.PathOnClient = fileNames[i];
            cv.VersionData = pdfs[i];
            cv.FirstPublishLocationId = recordIds[i];
            cvs.add(cv);
        }
        if (!cvs.isEmpty()) {
            insert cvs;
        }
    }

    global void finish(Database.BatchableContext bc) {
        // Log summary
        System.debug(LoggingLevel.INFO,
            'SmartDocs Batch Complete: ' + totalProcessed + ' processed, ' +
            totalSucceeded + ' succeeded, ' + totalFailed + ' failed'
        );

        // Optionally send email notification
        if (totalFailed > 0) {
            System.debug(LoggingLevel.WARN, 'Failed records: ' + JSON.serialize(errors));
        }
    }
}
