export declare const MACHINE_DIR: string;
export declare const POINTER_FILE: string;
export declare function defaultRuntimeDir(root: string): string;
export declare function pointedRuntimeDir(): string | undefined;
export declare function resolveRuntimeDir(root: string): string;
export declare function claimRuntimeHome(runtimeDir: string): string | undefined;
export declare function setRuntimeHome(runtimeDir: string): string;
export declare function knownRuntimeDirs(root: string): string[];
