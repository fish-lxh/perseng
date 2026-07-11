export = RoleLifecycle;
declare class RoleLifecycle {
    static archiveV1(roleId: any): Promise<{
        ok: boolean;
        marker: string;
        alreadyArchived: boolean;
        error?: undefined;
    } | {
        ok: boolean;
        error: string;
        marker?: undefined;
        alreadyArchived?: undefined;
    }>;
    static unarchiveV1(roleId: any): Promise<{
        ok: boolean;
        alreadyActive: boolean;
        error?: undefined;
    } | {
        ok: boolean;
        error: string;
        alreadyActive?: undefined;
    }>;
    static isV1Archived(roleId: any): Promise<boolean>;
    static listArchivedV1(): Promise<string[]>;
    static archiveV2(roleId: any): Promise<{
        ok: boolean;
        error?: undefined;
    } | {
        ok: boolean;
        error: string;
    }>;
    static unarchiveV2(roleId: any): Promise<{
        ok: boolean;
        error?: undefined;
    } | {
        ok: boolean;
        error: string;
    }>;
    static resolveVersion(roleId: any): {
        version: string;
        id: string;
    };
    static archive(roleId: string): Promise<{
        version: "v1" | "v2";
        ok: boolean;
    }>;
    static unarchive(roleId: any): Promise<{
        version: string;
        id: string;
        ok: boolean;
        error: string;
    } | {
        ok: boolean;
        error?: undefined;
        version: string;
        id: string;
    } | {
        ok: boolean;
        alreadyActive: boolean;
        error?: undefined;
        version: string;
        id: string;
    }>;
    static isArchived(roleId: any): Promise<boolean>;
    static archiveBatch(roleIds: string[]): Promise<Array<{
        version: any;
        id: any;
        ok: any;
    }>>;
    static unarchiveBatch(roleIds: any): Promise<({
        version: string;
        id: string;
        ok: boolean;
        error: string;
    } | {
        ok: boolean;
        error?: undefined;
        version: string;
        id: string;
    })[]>;
    static delete(roleId: string, opts?: {
        force?: boolean | undefined;
    }): Promise<{
        version: any;
        id: any;
        ok: any;
        protected?: any;
        error?: any;
    }>;
    static deleteV1(roleId: any): Promise<{
        ok: boolean;
        error: string;
    } | {
        ok: boolean;
        error?: undefined;
    }>;
    static deleteV2(roleId: any): Promise<{
        ok: boolean;
        error?: undefined;
    } | {
        ok: boolean;
        error: string;
    }>;
    static deleteBatch(roleIds: string[], opts?: Object): Promise<{
        version: any;
        id: any;
        ok: any;
        protected?: any;
        error?: any;
    }[]>;
}
declare namespace RoleLifecycle {
    export { PROTECTED_ROLES, isProtectedRole, probeV1Paths, v1ArchiveMarkerPath, v1RoleExists, v1RoleRoot, setRolexBridgeFactory, resetRolexBridgeFactory };
}
declare const PROTECTED_ROLES: Set<string>;
declare function isProtectedRole(roleId: any): boolean;
declare function probeV1Paths(roleId: any): {
    dirPath: string;
    filePath: string;
    dirRoleFile: string;
};
declare function v1ArchiveMarkerPath(roleId: any): string;
declare function v1RoleExists(roleId: any): boolean;
declare function v1RoleRoot(): string;
declare function setRolexBridgeFactory(factory: any): void;
declare function resetRolexBridgeFactory(): void;
//# sourceMappingURL=RoleLifecycle.d.ts.map