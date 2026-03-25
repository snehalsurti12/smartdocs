# SmartDocs Salesforce Package

Generate PDF documents from SmartDocs templates directly in Salesforce — via buttons, Flows, Batch Apex, or Agentforce.

## Prerequisites

- A SmartDocs instance (self-hosted or cloud) with API access
- A SmartDocs API key (`sk_live_...`) for your tenant
- Salesforce Developer Edition, Sandbox, or Production org

## Quick Setup

### 1. Deploy the Package

```bash
cd salesforce
sfdx force:source:deploy -p force-app -u your-org-alias
```

### 2. Add Remote Site Setting

In Salesforce Setup → Remote Site Settings → New:
- **Name**: SmartDocs_API
- **URL**: `https://your-smartdocs-url.up.railway.app`
- **Active**: checked

### 3. Configure Custom Metadata

In Setup → Custom Metadata Types → SmartDocs Config → Manage Records → Edit "Default":
- **Endpoint URL**: your SmartDocs instance URL
- **API Key**: your `sk_live_...` key

### 4. Create Field Mappings

1. Create a `SmartDocs_Template_Mapping__c` record:
   - **Template ID**: copy from SmartDocs editor
   - **Template Name**: display name
   - **Object Type**: Salesforce object API name (e.g. `Account`)
   - **Active**: checked

2. Create `SmartDocs_Field_Map__c` child records for each field:
   - **Template Field**: the template's data path (e.g. `company.name`)
   - **SF Field**: Salesforce field API name (e.g. `Name`)

### 5. Add to Record Page

In Lightning App Builder, drag the **SmartDocs Document Generator** component onto any record page.

## Usage

### From a Button (LWC)
The `smartDocsGenerator` component provides a "Generate Document" button on record pages. Users select a template, click generate, and the PDF is attached to the record.

### From Flow Builder
Use the **Generate SmartDocs Document** action in any Flow:
- **Mapping ID**: SmartDocs_Template_Mapping__c record ID
- **Record ID**: the record to generate for
- **File Name**: (optional) name for the PDF

### From Agentforce
The same invocable action is automatically available as an Agentforce Action. Add it to a Topic with instructions like:
> "When a customer asks for a document, invoice, or statement, use the Generate SmartDocs Document action with the appropriate template mapping."

### From Apex
```apex
// Single document
Blob pdf = SmartDocsService.renderDocument(mappingId, recordId);
Id fileId = SmartDocsService.attachToRecord(recordId, pdf, 'Invoice.pdf');

// Or render + attach in one call
Id fileId = SmartDocsService.renderAndAttach(mappingId, recordId, 'Invoice.pdf');
```

### Mass Generation (Batch)
```apex
SmartDocsBatchRenderer batch = new SmartDocsBatchRenderer(
    mappingId,
    'Monthly Statement'
);
Database.executeBatch(batch, 10); // 10 records per batch
```

With a filter:
```apex
SmartDocsBatchRenderer batch = new SmartDocsBatchRenderer(
    mappingId,
    'Invoice',
    'Type = \'Customer\' AND AnnualRevenue > 100000'
);
Database.executeBatch(batch, 10);
```

## How It Works

```
Salesforce Record
    ↓
SmartDocsPayloadBuilder reads mapping config
    ↓
Builds dynamic SOQL → queries record fields
    ↓
Transforms to JSON: { "company": { "name": "Acme" }, ... }
    ↓
POST to SmartDocs /api/render with templateId + data
    ↓
SmartDocs renders PDF (2-3 seconds)
    ↓
PDF binary returned → saved as ContentVersion
    ↓
File attached to Salesforce record
```

No data is stored by SmartDocs — it's zero-retention. Data exists only in memory during rendering.

## Governor Limits

| Limit | Value | Impact |
|-------|-------|--------|
| HTTP callouts per transaction | 100 | Max ~100 docs per Apex transaction |
| Callout timeout | 120 seconds | Single render takes 2-5 sec |
| Response size | 12 MB | Covers PDFs up to ~10 MB |
| Batch size recommendation | 10 per execute() | Stays within callout limits |

## Package Contents

| Component | Type | Purpose |
|-----------|------|---------|
| `SmartDocsService` | Apex Class | HTTP callouts, auth, file attachment |
| `SmartDocsPayloadBuilder` | Apex Class | Auto-builds JSON from field mappings |
| `SmartDocsRenderInvocable` | Apex Class | Flow + Agentforce action |
| `SmartDocsBatchRenderer` | Apex Class | Mass document generation |
| `SmartDocsServiceTest` | Apex Test | 75%+ code coverage |
| `smartDocsGenerator` | LWC | Record page button component |
| `SmartDocs_Config__mdt` | Custom Metadata | API endpoint + key storage |
| `SmartDocs_Template_Mapping__c` | Custom Object | Template → object mapping |
| `SmartDocs_Field_Map__c` | Custom Object | Individual field mappings |
