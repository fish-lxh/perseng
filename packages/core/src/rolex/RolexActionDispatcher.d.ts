export type DispatchOperation = 'activate' | 'born' | 'identity' | 'want' | 'plan' | 'todo' | 'finish' | 'achieve' | 'abandon' | 'focus' | 'synthesize' | 'growup' | 'found' | 'establish' | 'hire' | 'fire' | 'appoint' | 'dismiss' | 'directory' | 'reflect' | 'realize' | 'master' | 'forget' | 'skill' | 'retire' | 'die' | 'rehire' | 'train' | 'charter' | 'dissolve' | 'charge' | 'require' | 'abolish' | 'archive' | 'unarchive' | 'delete';
export interface DispatchArgs {
    role?: string;
    name?: string;
    source?: string;
    roleIds?: string[];
    archiveV1?: string[];
    type?: string;
    parent?: string;
    org?: string;
    position?: string;
    encounters?: unknown;
    experience?: string;
    id?: string;
    experiences?: unknown;
    principle?: string;
    procedure?: string;
    nodeId?: string;
    locator?: string;
    individual?: string;
    skillId?: string;
    content?: string;
    skill?: string;
    after?: string;
    fallback?: string;
    testable?: boolean;
    force?: boolean;
}
export interface DispatchResult {
    operation: string;
    total?: number;
    failed?: number;
    protected?: number;
    force?: boolean;
    results?: Array<{
        ok: boolean;
        version?: string;
        id?: string;
        error?: string;
        protected?: boolean;
    }>;
    archiveV1Results?: Array<{
        ok: boolean;
        version?: string;
        id?: string;
        error?: string;
    }>;
    [key: string]: unknown;
}
export declare class RolexActionDispatcher {
    private bridge;
    constructor();
    dispatch(operation: DispatchOperation, args?: DispatchArgs): Promise<unknown>;
    private activateOp;
    private bornOp;
    private prepareForBorn;
    private identityOp;
    private wantOp;
    private planOp;
    private todoOp;
    private finishOp;
    private achieveOp;
    private abandonOp;
    private focusOp;
    private synthesizeOp;
    private foundOp;
    private establishOp;
    private hireOp;
    private fireOp;
    private appointOp;
    private dismissOp;
    private directoryOp;
    private reflectOp;
    private realizeOp;
    private masterOp;
    private forgetOp;
    private skillOp;
    private retireOp;
    private dieOp;
    private rehireOp;
    private trainOp;
    private charterOp;
    private dissolveOp;
    private chargeOp;
    private requireOp;
    private abolishOp;
    private archiveOp;
    private unarchiveOp;
    private deleteOp;
    isV2Role(roleId: string): Promise<boolean>;
}
//# sourceMappingURL=RolexActionDispatcher.d.ts.map