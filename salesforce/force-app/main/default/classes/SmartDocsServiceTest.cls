@isTest
private class SmartDocsServiceTest {

    private class MockRenderSuccess implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            if (req.getEndpoint().contains('/api/render')) {
                res.setStatusCode(200);
                res.setHeader('Content-Type', 'application/pdf');
                res.setBodyAsBlob(Blob.valueOf('%PDF-1.4 test content'));
            } else if (req.getEndpoint().contains('/api/templates/')) {
                res.setStatusCode(200);
                res.setHeader('Content-Type', 'application/json');
                res.setBody('{"templateId":"tmpl_test","templateName":"Test","fields":[{"path":"name","required":true,"type":"string"}]}');
            }
            return res;
        }
    }

    private class MockRenderError implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(422);
            res.setBody('{"error":"Missing required fields","missingRequired":["name"]}');
            return res;
        }
    }

    @isTest
    static void testGetTemplateFields() {
        Test.setMock(HttpCalloutMock.class, new MockRenderSuccess());
        Test.startTest();
        Map<String, Object> fields = SmartDocsService.getTemplateFields('tmpl_test');
        Test.stopTest();
        System.assertNotEquals(null, fields);
        System.assertEquals('tmpl_test', fields.get('templateId'));
    }

    @isTest
    static void testRenderAndAttach() {
        // Create test account
        Account acc = new Account(Name = 'Test Corp');
        insert acc;

        // Create mapping records
        SmartDocs_Template_Mapping__c mapping = new SmartDocs_Template_Mapping__c(
            Template_ID__c = 'tmpl_test',
            Template_Name__c = 'Test Template',
            Object_Type__c = 'Account',
            Active__c = true
        );
        insert mapping;

        SmartDocs_Field_Map__c fieldMap = new SmartDocs_Field_Map__c(
            SmartDocs_Template_Mapping__c = mapping.Id,
            Template_Field__c = 'name',
            SF_Field__c = 'Name',
            Field_Type__c = 'string',
            Is_Required__c = true,
            Is_Child_Relationship__c = false
        );
        insert fieldMap;

        Test.setMock(HttpCalloutMock.class, new MockRenderSuccess());
        Test.startTest();
        Id cvId = SmartDocsService.renderAndAttach(mapping.Id, acc.Id, 'Test Invoice');
        Test.stopTest();

        System.assertNotEquals(null, cvId, 'ContentVersion should be created');
        ContentVersion cv = [SELECT Title FROM ContentVersion WHERE Id = :cvId];
        System.assertEquals('Test Invoice.pdf', cv.Title);
    }

    @isTest
    static void testRenderError() {
        Account acc = new Account(Name = 'Test Corp');
        insert acc;

        SmartDocs_Template_Mapping__c mapping = new SmartDocs_Template_Mapping__c(
            Template_ID__c = 'tmpl_test',
            Template_Name__c = 'Test Template',
            Object_Type__c = 'Account',
            Active__c = true
        );
        insert mapping;

        Test.setMock(HttpCalloutMock.class, new MockRenderError());
        Test.startTest();
        try {
            SmartDocsService.renderDocument(mapping.Id, acc.Id);
            System.assert(false, 'Should have thrown exception');
        } catch (SmartDocsService.SmartDocsException e) {
            System.assert(e.getMessage().contains('422'), 'Should contain status code');
        }
        Test.stopTest();
    }

    @isTest
    static void testInvocable() {
        Account acc = new Account(Name = 'Test Corp');
        insert acc;

        SmartDocs_Template_Mapping__c mapping = new SmartDocs_Template_Mapping__c(
            Template_ID__c = 'tmpl_test',
            Template_Name__c = 'Test Template',
            Object_Type__c = 'Account',
            Active__c = true
        );
        insert mapping;

        SmartDocs_Field_Map__c fieldMap = new SmartDocs_Field_Map__c(
            SmartDocs_Template_Mapping__c = mapping.Id,
            Template_Field__c = 'name',
            SF_Field__c = 'Name',
            Field_Type__c = 'string',
            Is_Required__c = true,
            Is_Child_Relationship__c = false
        );
        insert fieldMap;

        Test.setMock(HttpCalloutMock.class, new MockRenderSuccess());
        Test.startTest();

        SmartDocsRenderInvocable.RenderRequest req = new SmartDocsRenderInvocable.RenderRequest();
        req.mappingId = mapping.Id;
        req.recordId = acc.Id;
        req.fileName = 'Flow Test';

        List<SmartDocsRenderInvocable.RenderResult> results =
            SmartDocsRenderInvocable.renderDocuments(new List<SmartDocsRenderInvocable.RenderRequest>{ req });

        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals(true, results[0].success);
        System.assertNotEquals(null, results[0].contentVersionId);
    }
}
