declare const ResourceManager: new (options?: unknown) => ResourceManagerInstance;
declare const ResourceProtocolParser: new () => ResourceProtocolParserInstance;
declare const RoleLifecycle: RoleLifecycleClass;
interface ResourceManagerInstance {
    [key: string]: unknown;
}
interface ResourceProtocolParserInstance {
    parse(ref: string): unknown;
}
interface RoleLifecycleClass {
    new (): unknown;
}
declare const LoadingSemantics: any, ParsedReference: any, QueryParams: any, NestedReference: any, ResourceContent: any, LazyResource: any, ProcessedResult: any, ResourceResult: any, ProtocolInfo: any;
declare function getGlobalResourceManager(): ResourceManagerInstance;
declare function resetGlobalResourceManager(): void;
declare const _default: {
    ResourceManager: new (options?: unknown) => ResourceManagerInstance;
    getGlobalResourceManager: typeof getGlobalResourceManager;
    resetGlobalResourceManager: typeof resetGlobalResourceManager;
    ResourceProtocolParser: new () => ResourceProtocolParserInstance;
    RoleLifecycle: RoleLifecycleClass;
    LoadingSemantics: any;
    ParsedReference: any;
    QueryParams: any;
    NestedReference: any;
    ResourceContent: any;
    LazyResource: any;
    ProcessedResult: any;
    ResourceResult: any;
    ProtocolInfo: any;
    createManager: (options?: unknown) => ResourceManagerInstance;
    parse: (resourceRef: string) => unknown;
    validate: (resourceRef: string) => boolean;
};
export default _default;
export { ResourceManager, ResourceProtocolParser, RoleLifecycle, getGlobalResourceManager, resetGlobalResourceManager, LoadingSemantics, ParsedReference, QueryParams, NestedReference, ResourceContent, LazyResource, ProcessedResult, ResourceResult, ProtocolInfo, };
//# sourceMappingURL=index.d.ts.map