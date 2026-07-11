export = CognitionManager;
declare class CognitionManager {
    static getInstance(resourceManager?: Object): CognitionManager;
    constructor(resourceManager?: null);
    resourceManager: any;
    systems: Map<any, any>;
    basePath: string;
    getRolePath(roleId: string): string;
    getNetworkFilePath(roleId: string): string;
    ensureRoleDirectory(roleId: string): Promise<void>;
    getSystem(roleId: string): CognitionSystem;
    saveSystem(roleId: string): Promise<void>;
    prime(roleId: string): Mind;
    recall(roleId: string, query: string, options?: {
        mode: string;
    }): Promise<Mind>;
    remember(roleId: string, engrams: any[]): Promise<void>;
    parseSchema(schema: string): Array<string>;
    clearRole(roleId: string): Promise<void>;
    listRoles(): Promise<string[]>;
}
import CognitionSystem = require("./CognitionSystem");
//# sourceMappingURL=CognitionManager.d.ts.map