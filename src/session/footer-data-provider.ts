/**
 * Provides extension statuses and provider counts for the footer.
 * Git branch support has been removed for the generic AI CLI.
 */
export class FooterDataProvider {
	private extensionStatuses = new Map<string, string>();
	private branchChangeCallbacks = new Set<() => void>();
	private availableProviderCount = 0;
	private disposed = false;

	constructor(_cwd: string) {}

	/** Always returns null as git support is removed */
	getGitBranch(): string | null {
		return null;
	}

	/** Extension status texts set via ctx.ui.setStatus() */
	getExtensionStatuses(): ReadonlyMap<string, string> {
		return this.extensionStatuses;
	}

	/** No-op branch change subscription */
	onBranchChange(callback: () => void): () => void {
		this.branchChangeCallbacks.add(callback);
		return () => this.branchChangeCallbacks.delete(callback);
	}

	/** Internal: set extension status */
	setExtensionStatus(key: string, text: string | undefined): void {
		if (text === undefined) {
			this.extensionStatuses.delete(key);
		} else {
			this.extensionStatuses.set(key, text);
		}
	}

	/** Internal: clear extension statuses */
	clearExtensionStatuses(): void {
		this.extensionStatuses.clear();
	}

	/** Number of unique providers with available models (for footer display) */
	getAvailableProviderCount(): number {
		return this.availableProviderCount;
	}

	/** Internal: update available provider count */
	setAvailableProviderCount(count: number): void {
		this.availableProviderCount = count;
	}

	setCwd(_cwd: string): void {}

	/** Internal: cleanup */
	dispose(): void {
		this.disposed = true;
		this.branchChangeCallbacks.clear();
	}
}

/** Read-only view for extensions */
export type ReadonlyFooterDataProvider = Pick<
	FooterDataProvider,
	"getGitBranch" | "getExtensionStatuses" | "getAvailableProviderCount" | "onBranchChange"
>;
