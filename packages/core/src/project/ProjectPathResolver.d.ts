export = ProjectPathResolver;
declare class ProjectPathResolver {
    projectDirs: {
        root: string;
        src: string;
        lib: string;
        build: string;
        dist: string;
        docs: string;
        test: string;
        tests: string;
        spec: string;
        config: string;
        scripts: string;
        assets: string;
        public: string;
        static: string;
        templates: string;
        examples: string;
        tools: string;
        '.perseng': string;
    };
    resolvePath(resourcePath: string): string;
    getProjectRoot(): string;
    getPersengDirectory(): string;
    getResourceDirectory(): string;
    getRegistryPath(): string;
    getMemoryDirectory(): string;
    private _validatePath;
    getSupportedDirectories(): Array<string>;
    isSupportedDirectory(dirType: string): boolean;
}
declare namespace ProjectPathResolver {
    export { getGlobalProjectPathResolver };
}
declare function getGlobalProjectPathResolver(): ProjectPathResolver;
//# sourceMappingURL=ProjectPathResolver.d.ts.map