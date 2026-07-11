export = ToolManualFormatter;
declare class ToolManualFormatter {
    format(toolInstance: Object, toolResource: string, sourceCode?: string): string;
    safeGet(instance: any, methodName: any): any;
    extractComments(sourceCode: any): any;
    buildMarkdown(data: any): string;
    formatParameters(params: any): string;
    collectParameterRows(schema: any, prefix?: string, parentRequired?: any[]): any;
    formatEnvironment(env: any): string | null;
    formatDependencies(deps: any): string;
    formatBusinessErrors(errors: any): string;
    formatInterfaces(toolInstance: any): string;
    formatExamples(resource: any, schema: any): string;
    formatYAMLParams(lines: any, params: any, indent?: string): void;
    generateExampleParams(paramSchema: any): {};
    formatType(prop: any): any;
}
//# sourceMappingURL=ToolManualFormatter.d.ts.map