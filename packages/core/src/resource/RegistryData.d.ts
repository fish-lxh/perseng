export = RegistryData;
declare class RegistryData {
    static fromFile(source: string, filePath: string): Promise<RegistryData>;
    static createEmpty(source: string, filePath: string): RegistryData;
    constructor(source: string, filePath: string, resources?: Array<{
        [k: string]: unknown;
    }>, metadata?: Object);
    source: string;
    filePath: string;
    resources: any[];
    metadata: {
        constructor: Function;
        toString(): string;
        toLocaleString(): string;
        valueOf(): Object;
        hasOwnProperty(v: PropertyKey): boolean;
        isPrototypeOf(v: Object): boolean;
        propertyIsEnumerable(v: PropertyKey): boolean;
        version: string;
        description: string;
        createdAt: string;
        updatedAt: string;
    };
    cache: Map<any, any>;
    addResource(resource: {
        [k: string]: unknown;
    } | Object): void;
    removeResource(id: string, protocol: string): boolean;
    findResources(filters?: Object): Array<{
        [k: string]: unknown;
    }>;
    findResourceById(id: string, protocol?: string): {
        [k: string]: unknown;
    } | null;
    getResourcesByProtocol(protocol: string): Array<{
        [k: string]: unknown;
    }>;
    getResourceMap(includeSourcePrefix?: boolean): Map<string, string>;
    getAllResources(): Array<{
        [k: string]: unknown;
    }>;
    getStats(): Object;
    merge(otherRegistry: RegistryData, overwrite?: boolean): void;
    save(): Promise<void>;
    private _updateMetadata;
    get size(): number;
    isEmpty(): boolean;
    clear(): void;
    clone(): RegistryData;
    toJSON(): Object;
}
//# sourceMappingURL=RegistryData.d.ts.map