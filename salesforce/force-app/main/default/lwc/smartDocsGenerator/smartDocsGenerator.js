import { LightningElement, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import renderDocumentForLwc from '@salesforce/apex/SmartDocsService.renderDocumentForLwc';

export default class SmartDocsGenerator extends NavigationMixin(LightningElement) {
    @api recordId;
    @api objectApiName;

    selectedMapping = '';
    fileName = '';
    isGenerating = false;
    generatedFile = null;
    error = null;

    // TODO: Wire to fetch active mappings for this object type
    // For now, hardcoded options — replace with dynamic query
    get mappingOptions() {
        return [
            // These would be dynamically loaded from SmartDocs_Template_Mapping__c
            // where Object_Type__c matches this.objectApiName
        ];
    }

    get isGenerateDisabled() {
        return !this.selectedMapping;
    }

    handleMappingChange(event) {
        this.selectedMapping = event.detail.value;
        this.error = null;
    }

    handleFileNameChange(event) {
        this.fileName = event.target.value;
    }

    async handleGenerate() {
        this.isGenerating = true;
        this.error = null;
        this.generatedFile = null;

        try {
            const result = await renderDocumentForLwc({
                mappingId: this.selectedMapping,
                recordId: this.recordId,
                fileName: this.fileName || 'Document'
            });

            if (result && result.success) {
                this.generatedFile = {
                    contentVersionId: result.contentVersionId,
                    downloadUrl: result.downloadUrl
                };
            } else {
                this.error = (result && result.errorMessage) || 'Document generation failed.';
            }
        } catch (err) {
            this.error = err.body ? err.body.message : err.message || 'An unexpected error occurred.';
        } finally {
            this.isGenerating = false;
        }
    }

    handleDownload() {
        if (this.generatedFile && this.generatedFile.downloadUrl) {
            this[NavigationMixin.Navigate]({
                type: 'standard__webPage',
                attributes: {
                    url: this.generatedFile.downloadUrl
                }
            });
        }
    }

    handleReset() {
        this.generatedFile = null;
        this.error = null;
        this.fileName = '';
    }
}
