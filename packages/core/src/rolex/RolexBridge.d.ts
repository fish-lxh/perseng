import type { Rolex, Platform } from 'rolexjs';
export interface V2Role {
    id: string;
    name: string;
    description: string;
    source: 'system' | 'rolex';
    version: 'v2';
    protocol: 'role';
    archived: boolean;
}
interface DirectoryRole {
    name: string;
    org?: string;
    position?: string;
}
interface DirectoryOrganization {
    name: string;
    members: Array<{
        name: string;
        position?: string;
    }>;
    positions: unknown[];
}
export interface DirectoryResult {
    roles: DirectoryRole[];
    organizations: DirectoryOrganization[];
}
export declare class RolexBridge {
    static SEED_ROLES: string[];
    platform: Platform | null;
    rolex: Rolex | null;
    initialized: boolean;
    initializing: Promise<void> | null;
    currentRoleName: string | null;
    rolexRoot: string;
    constructor();
    ensureInitialized(): Promise<void>;
    private doInit;
    private syncSeedRoles;
    isV2Role(roleId: string): Promise<boolean>;
    activate(roleId: string): Promise<string>;
    born(name: string, source: string): Promise<string>;
    identity(roleId?: string): Promise<string>;
    want(name: string, source: string, _options?: Record<string, unknown>): Promise<unknown>;
    plan(source: string, id: string, after?: string, fallback?: string): Promise<unknown>;
    todo(name: string, source: string, _options?: Record<string, unknown>): Promise<unknown>;
    finish(name: string): Promise<unknown>;
    achieve(experience?: string): Promise<unknown>;
    abandon(experience?: string): Promise<unknown>;
    focus(name: string): Promise<unknown>;
    synthesize(name: string, source: string, _type: string, targetRole?: string): Promise<string>;
    growup(name: string, source: string, type: string, targetRole?: string): Promise<string>;
    found(name: string, source: string, _parent?: string): Promise<string>;
    establish(positionName: string, source: string, _orgName?: string): Promise<string>;
    hire(roleName: string, orgName: string): Promise<string>;
    fire(roleName: string, orgName: string): Promise<string>;
    appoint(roleName: string, positionName: string, _orgName?: string): Promise<string>;
    dismiss(roleName: string, orgName: string): Promise<string>;
    directory(): Promise<DirectoryResult>;
    private parseCensusOutput;
    reflect(encounters: unknown, experience: string, id?: string): Promise<unknown>;
    realize(experiences: unknown, principle: string, id?: string): Promise<unknown>;
    master(procedure: string, id: string, experiences?: unknown): Promise<unknown>;
    forget(nodeId: string): Promise<unknown>;
    skill(locator: string): Promise<unknown>;
    retire(individualId: string): Promise<string>;
    die(individualId: string): Promise<string>;
    rehire(individualId: string): Promise<string>;
    train(individualId: string, skillId: string, content: string): Promise<string>;
    charter(orgName: string, content: string): Promise<string>;
    dissolve(orgName: string): Promise<string>;
    charge(positionName: string, content: string): Promise<string>;
    require(positionName: string, skillId: string): Promise<string>;
    abolish(positionName: string): Promise<string>;
    static _parseCensusIds(text: string): string[];
    listV2Roles({ includeRetired }?: {
        includeRetired?: boolean;
    }): Promise<V2Role[]>;
    listRetiredV2(): Promise<V2Role[]>;
    private getRetiredIdSet;
    private requireActiveRole;
}
export declare function getRolexBridge(): RolexBridge;
export {};
//# sourceMappingURL=RolexBridge.d.ts.map