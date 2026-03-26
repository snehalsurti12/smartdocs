import { LightningElement, track } from 'lwc';
import listTemplates from '@salesforce/apex/SmartDocsMapperController.listTemplates';
import getTemplateFields from '@salesforce/apex/SmartDocsMapperController.getTemplateFields';
import getObjectFields from '@salesforce/apex/SmartDocsMapperController.getObjectFields';
import getChildRelationships from '@salesforce/apex/SmartDocsMapperController.getChildRelationships';
import saveMapping from '@salesforce/apex/SmartDocsMapperController.saveMapping';

export default class SmartDocsFieldMapper extends LightningElement {
    templateId = '';
    templateName = '';
    primaryObject = '';
    existingMappingId = null;

    @track templates = [];
    @track templateFields = null;
    @track objectFields = null;
    @track childRelationships = null;
    @track singleFields = [];
    @track arrayFields = [];
    @track fieldMappings = {};
    @track arrayMappings = {};

    isLoading = false;
    isSaving = false;
    saveSuccess = false;
    templatesLoaded = false;
    error = null;

    get templateOptions() {
        return this.templates.map(t => ({
            label: `${t.name}${t.status ? ' (' + t.status + ')' : ''}`,
            value: t.id,
            description: t.description || ''
        }));
    }

    get selectedTemplateDescription() {
        const tmpl = this.templates.find(t => t.id === this.templateId);
        return tmpl ? tmpl.description : '';
    }

    get objectFieldOptions() {
        if (!this.objectFields) return [];
        return [
            { label: '-- None --', value: '' },
            ...this.objectFields.map(f => ({
                label: `${f.label} (${f.apiName})`,
                value: f.apiName
            }))
        ];
    }

    get childRelationshipOptions() {
        if (!this.childRelationships) return [];
        return [
            { label: '-- None --', value: '' },
            ...this.childRelationships.map(r => ({
                label: `${r.childObjectLabel} (${r.relationshipName})`,
                value: r.relationshipName + '|' + r.childObject
            }))
        ];
    }

    async handleLoadTemplates() {
        this.isLoading = true;
        this.error = null;
        try {
            this.templates = await listTemplates();
            this.templatesLoaded = true;
        } catch (err) {
            this.error = err.body ? err.body.message : 'Failed to load templates from SmartDocs.';
        } finally {
            this.isLoading = false;
        }
    }

    async handleTemplateSelect(event) {
        this.templateId = event.detail.value;
        this.error = null;
        const tmpl = this.templates.find(t => t.id === this.templateId);
        this.templateName = tmpl ? tmpl.name : this.templateId;
        // Auto-fetch fields on selection
        await this.handleFetchFields();
    }

    handlePrimaryObjectChange(event) {
        this.primaryObject = event.target.value;
        this.objectFields = null;
        this.childRelationships = null;
        this.error = null;
    }

    async handleFetchFields() {
        this.isLoading = true;
        this.error = null;
        try {
            const result = await getTemplateFields({ templateId: this.templateId });
            this.templateName = result.templateName || this.templateId;
            const fields = result.fields || [];

            this.singleFields = fields
                .filter(f => f.cardinality === 'one' || (!f.cardinality && f.type !== 'array'))
                .map(f => ({ ...f, sfField: '' }));

            this.arrayFields = fields
                .filter(f => f.cardinality === 'many' || f.type === 'array')
                .map(f => ({
                    ...f,
                    selectedRelationship: '',
                    childFieldOptions: [],
                    children: (f.children || []).map(c => ({ ...c, sfField: '' }))
                }));

            this.templateFields = fields;
        } catch (err) {
            this.error = err.body ? err.body.message : 'Failed to fetch template fields.';
            this.templateFields = null;
        } finally {
            this.isLoading = false;
        }
    }

    async handleLoadObjectFields() {
        this.isLoading = true;
        this.error = null;
        try {
            const [fields, relationships] = await Promise.all([
                getObjectFields({ objectApiName: this.primaryObject }),
                getChildRelationships({ objectApiName: this.primaryObject })
            ]);
            this.objectFields = fields;
            this.childRelationships = relationships;
        } catch (err) {
            this.error = err.body ? err.body.message : 'Failed to load object metadata.';
        } finally {
            this.isLoading = false;
        }
    }

    handleFieldMapChange(event) {
        const templateField = event.target.dataset.templateField;
        const sfField = event.detail.value;
        this.fieldMappings[templateField] = sfField;

        this.singleFields = this.singleFields.map(f =>
            f.path === templateField ? { ...f, sfField } : f
        );
    }

    async handleArrayRelationshipChange(event) {
        const arrayPath = event.target.dataset.arrayPath;
        const value = event.detail.value; // "RelationshipName|ChildObject"
        const [relName, childObj] = value ? value.split('|') : ['', ''];

        if (!this.arrayMappings[arrayPath]) {
            this.arrayMappings[arrayPath] = { relationship: '', childObject: '', childMappings: {} };
        }
        this.arrayMappings[arrayPath].relationship = relName;
        this.arrayMappings[arrayPath].childObject = childObj;

        // Fetch child object fields
        let childFieldOpts = [];
        if (childObj) {
            try {
                const childFields = await getObjectFields({ objectApiName: childObj });
                childFieldOpts = [
                    { label: '-- None --', value: '' },
                    ...childFields.map(f => ({
                        label: `${f.label} (${f.apiName})`,
                        value: f.apiName
                    }))
                ];
            } catch (err) {
                console.error('Failed to load child fields:', err);
            }
        }

        this.arrayFields = this.arrayFields.map(f => {
            if (f.path === arrayPath) {
                return { ...f, selectedRelationship: value, childFieldOptions: childFieldOpts };
            }
            return f;
        });
    }

    handleChildFieldMapChange(event) {
        const arrayPath = event.target.dataset.arrayPath;
        const childPath = event.target.dataset.childPath;
        const sfField = event.detail.value;

        if (!this.arrayMappings[arrayPath]) {
            this.arrayMappings[arrayPath] = { relationship: '', childObject: '', childMappings: {} };
        }
        this.arrayMappings[arrayPath].childMappings[childPath] = sfField;

        this.arrayFields = this.arrayFields.map(f => {
            if (f.path === arrayPath) {
                return {
                    ...f,
                    children: f.children.map(c =>
                        c.path === childPath ? { ...c, sfField } : c
                    )
                };
            }
            return f;
        });
    }

    async handleSave() {
        this.isSaving = true;
        this.saveSuccess = false;
        this.error = null;

        try {
            // Build data sources
            const dataSources = [];
            const fieldMaps = [];

            // Primary source
            const primaryTempId = 'primary_0';
            dataSources.push({
                tempId: primaryTempId,
                sourceType: 'primary',
                objectApiName: this.primaryObject,
                isPrimary: true
            });

            // Single field maps → primary source
            for (const f of this.singleFields) {
                if (f.sfField) {
                    fieldMaps.push({
                        templateField: f.path,
                        sfField: f.sfField,
                        fieldType: f.type || 'string',
                        isRequired: f.required || false,
                        isChildRelationship: false,
                        dataSourceTempId: primaryTempId
                    });
                }
            }

            // Array fields → child relationship sources
            for (const af of this.arrayFields) {
                const am = this.arrayMappings[af.path];
                if (!am || !am.relationship) continue;

                const childTempId = 'child_' + af.path;
                dataSources.push({
                    tempId: childTempId,
                    sourceType: 'child_relationship',
                    objectApiName: am.childObject,
                    relationshipName: am.relationship,
                    templateArrayPath: af.path,
                    isPrimary: false
                });

                // Child field maps
                for (const child of (af.children || [])) {
                    if (child.sfField) {
                        fieldMaps.push({
                            templateField: af.path + '.' + child.path,
                            sfField: child.sfField,
                            fieldType: child.type || 'string',
                            isRequired: false,
                            isChildRelationship: true,
                            childObject: am.childObject,
                            childRelationship: am.relationship,
                            dataSourceTempId: childTempId
                        });
                    }
                }
            }

            const mappingData = {
                mappingId: this.existingMappingId,
                templateId: this.templateId,
                templateName: this.templateName,
                objectType: this.primaryObject,
                dataSources,
                fieldMaps
            };

            const result = await saveMapping({ mappingJson: JSON.stringify(mappingData) });
            this.existingMappingId = result;
            this.saveSuccess = true;
        } catch (err) {
            this.error = err.body ? err.body.message : 'Failed to save mapping.';
        } finally {
            this.isSaving = false;
        }
    }
}
