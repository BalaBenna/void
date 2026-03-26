import { URI } from '../../../../base/common/uri.js';

export type voidDirectoryItem = {
	uri: URI;
	name: string;
	isSymbolicLink: boolean;
	children: voidDirectoryItem[] | null;
	isDirectory: boolean;
	isGitIgnoredDirectory: false | { numChildren: number }; // if directory is gitignored, we ignore children
}
