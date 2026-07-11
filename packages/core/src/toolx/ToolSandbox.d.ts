export = ToolSandbox;
declare class ToolSandbox {
    static create(toolReference: any, options?: {}): Promise<ToolSandbox>;
    constructor(toolReference: any, options?: {});
    toolReference: any;
    resourceManager: any;
    toolId: any;
    toolContent: any;
    toolInstance: any;
    dependencies: any[];
    directoryManager: ToolDirectoryManager | null;
    sandboxPath: any;
    sandboxContext: import("vm").Context | null;
    isolationManager: SandboxIsolationManager | null;
    fs: typeof import("fs") | null;
    vm: typeof import("vm") | null;
    logger: typeof import("@promptx/logger") | null;
    isAnalyzed: boolean;
    isPrepared: boolean;
    isInitialized: boolean;
    options: {
        timeout: number;
        enableDependencyInstall: boolean;
        rebuild: boolean;
    };
    init(): Promise<void>;
    setResourceManager(resourceManager: ResourceManager): void;
    clearSandbox(deleteDirectory?: boolean): Promise<void>;
    ensureInitialized(): Promise<void>;
    analyze(): Promise<Object>;
    prepareDependencies(): Promise<{
        success: boolean;
        message: string;
    }>;
    configureEnvironment(params?: Object): Promise<Object>;
    queryLogs(params?: Object): Promise<Object>;
    dryRun(params?: Object): Promise<Object>;
    execute(params?: {}): Promise<any>;
    createExecutionSandbox(): Promise<void>;
    createBasicSandboxEnvironment(): any;
    createSmartSandboxEnvironment(): any;
    extractToolId(toolReference: any): any;
    parseToolContent(content: any): any;
    getAnalysisResult(): {
        toolId: any;
        dependencies: any[];
        sandboxPath: any;
        hasMetadata: boolean;
        hasSchema: boolean;
    };
    installDependencies(): Promise<void>;
    checkNodeModulesExists(): Promise<boolean>;
    cleanup(): Promise<void>;
}
import ToolDirectoryManager = require("./ToolDirectoryManager");
import SandboxIsolationManager = require("./SandboxIsolationManager");
//# sourceMappingURL=ToolSandbox.d.ts.map