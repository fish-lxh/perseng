export = UserDiscovery;
declare class UserDiscovery extends BaseDiscovery {
    userProtocol: any;
    getUserProtocol(): any;
    discoverRegistry(): Promise<Map<any, any>>;
    loadFromRegistry(): Promise<Map<any, any>>;
    scanUserResources(): Promise<any[]>;
    private _scanDirectory;
    private _recursiveScan;
    private _processFile;
    _validateResourceFile(filePath: string, protocol: string): Promise<boolean>;
    buildRegistryFromResources(resources: any[]): Map<any, any>;
    generateRegistry(): Promise<RegistryData>;
    getRegistryData(): Promise<RegistryData>;
    discover(): Promise<any[]>;
}
import BaseDiscovery = require("./BaseDiscovery");
import RegistryData = require("../RegistryData");
//# sourceMappingURL=UserDiscovery.d.ts.map