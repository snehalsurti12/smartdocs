import { LightningElement, api, wire, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import renderDocumentForLwc from '@salesforce/apex/SmartDocsService.renderDocumentForLwc';
import getActiveMappings from '@salesforce/apex/SmartDocsMapperController.getActiveMappings';

export default class SmartDocsGenerator extends NavigationMixin(LightningElement) {
    @api recordId;
    @api objectApiName;

    selectedMapping = '';
    fileName = '';
    isGenerating = false;
    generatedFile = null;
    error = null;
    @track mappings = [];
    mappingsLoaded = false;

    @wire(getActiveMappings, { objectApiName: '$objectApiName' })
    wiredMappings({ error, data }) {
        if (data) {
            this.mappings = data;
            this.mappingsLoaded = true;
            this.error = null;
        } else if (error) {
            this.mappings = [];
            this.mappingsLoaded = true;
            this.error = error.body ? error.body.message : 'Failed to load templates.';
        }
    }

    get mappingOptions() {
        return this.mappings.map(m => ({
            label: m.Template_Name__c || m.Template_ID__c,
            value: m.Id
        }));
    }

    get hasMappings() {
        return this.mappings.length > 0;
    }

    get noMappingsMessage() {
        if (!this.mappingsLoaded) return '';
        if (!this.objectApiName) return 'Unable to detect the current object type.';
        return 'No document templates configured for ' + this.objectApiName + '. Use the Field Mapper tab to set up a mapping.';
    }

    get isGenerateDisabled() {
        return !this.selectedMapping || this.isGenerating;
    }

    get selectedTemplateName() {
        const m = this.mappings.find(m => m.Id === this.selectedMapping);
        return m ? m.Template_Name__c : 'Document';
    }

    handleMappingChange(event) {
        this.selectedMapping = event.detail.value;
        this.error = null;
        // Auto-set filename from template name
        const m = this.mappings.find(m => m.Id === this.selectedMapping);
        if (m && !this.fileName) {
            this.fileName = m.Template_Name__c || 'Document';
        }
    }

    handleFileNameChange(event) {
        this.fileName = event.detail.value || event.target.value || '';
    }

    async handleGenerate() {
        this.isGenerating = true;
        this.error = null;
        this.generatedFile = null;

        try {
            const result = await renderDocumentForLwc({
                mappingId: this.selectedMapping,
                recordId: this.recordId,
                fileName: this.fileName || this.selectedTemplateName || 'Document'
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
