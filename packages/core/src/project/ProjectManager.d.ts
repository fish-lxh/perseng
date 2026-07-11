export = ProjectManager;
declare class ProjectManager {
    static currentProject: {
        workingDirectory: null;
        mcpId: null;
        ideType: null;
        initialized: boolean;
    };
    static getCurrentMcpId(): string;
    static setCurrentProject(workingDirectory: string, mcpId: string, ideType: string): void;
    static getCurrentProjectPath(): string;
    static getCurrentProject(): Object;
    static isInitialized(): boolean;
    static generateMcpId(ideType?: string): string;
    static registerCurrentProject(workingDirectory: string, ideType?: string): Promise<Object>;
    persengHomeDir: string;
    projectsDir: string;
    registerProject(projectPath: string, mcpId: string, ideType: string): Promise<Object>;
    getProjectByMcpId(mcpId: string): Promise<Object | null>;
    getProjectsByMcpId(mcpId: string): Promise<any[]>;
    getProjectInstances(projectPath: string): Promise<any[]>;
    removeProject(mcpId: string, ideType: string, projectPath: string): Promise<boolean>;
    cleanupExpiredProjects(): Promise<number>;
    generateTopLevelProjectPrompt(contextType: string | undefined, mcpId: string, ideType: string): Promise<string>;
    validateProjectPath(projectPath: string): Promise<boolean>;
    generateConfigFileName(mcpId: string, ideType: string, projectPath: string): string;
    generateProjectHash(projectPath: string): string;
    getIdeType(mcpId: string): Promise<string>;
}
declare namespace ProjectManager {
    export { ProjectManager, getGlobalProjectManager };
}
declare function getGlobalProjectManager(): ProjectManager;
//# sourceMappingURL=ProjectManager.d.ts.map