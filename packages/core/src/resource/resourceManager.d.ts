export = ResourceManager;
declare class ResourceManager {
    registryData: any;
    protocolParser: ResourceProtocolParser;
    parser: ResourceProtocolParser;
    discoveryManager: DiscoveryManager;
    protocols: Map<any, any>;
    initializeProtocols(): void;
    initializeWithNewArchitecture(): Promise<void>;
    set initialized(value: any);
    get initialized(): any;
    populateRegistryData(): Promise<void>;
    setupLogicalProtocols(): void;
    loadResourceByProtocol(reference: string): Promise<string>;
    loadResource(resourceId: any): Promise<{
        success: boolean;
        content: string;
        resourceId: any;
        reference: any;
        error?: undefined;
    } | {
        success: boolean;
        error: unknown;
        resourceId: any;
        content?: undefined;
        reference?: undefined;
    }>;
    resolveProtocolReference(reference: any): Promise<{
        success: boolean;
        protocol: any;
        path: any;
        queryParams: any;
        reference: any;
        error?: undefined;
    } | {
        success: boolean;
        error: any;
        reference: any;
        protocol?: undefined;
        path?: undefined;
        queryParams?: undefined;
    }>;
    getAvailableProtocols(): any[];
    supportsProtocol(protocol: any): boolean;
    _initialized: any;
    resolve(resourceUrl: any): Promise<{
        success: boolean;
        content: string;
        resourceId: any;
        reference: any;
        error?: undefined;
    } | {
        success: boolean;
        error: unknown;
        resourceId: any;
        content?: undefined;
        reference?: undefined;
    }>;
    getStats(): {
        totalResources: any;
        protocols: any[];
        initialized: any;
    };
    refreshResources(): Promise<void>;
}
import ResourceProtocolParser = require("./resourceProtocolParser");
import DiscoveryManager = require("./discovery/DiscoveryManager");
//# sourceMappingURL=resourceManager.d.ts.map