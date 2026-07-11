export = ProjectDiscovery;
declare class ProjectDiscovery {
    source: string;
    priority: number;
    projectProtocol: any;
    getProjectProtocol(): any;
    discoverRegistry(): Promise<Map<any, any>>;
    loadFromRegistry(): Promise<Map<any, any>>;
    scanProjectResources(): Promise<any[]>;
    private _scanDirectory;
    private _recursiveScan;
    private _processFile;
    _validateResourceFile(filePath: string, protocol: string): Promise<boolean>;
    buildRegistryFromResources(resources: any[]): Map<any, any>;
    generateRegistry(): Promise<RegistryData>;
    getRegistryData(): Promise<RegistryData>;
}
import RegistryData = require("../resource/RegistryData");
//# sourceMappingURL=ProjectDiscovery.d.ts.map