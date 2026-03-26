declare namespace NodeJS {
	type ComposeFnParam = (source: any) => forge;
	interface ReadWriteStream {
		compose<T extends NodeJS.ReadableStream>(
			stream: T | ComposeFnParam | Iterable<T> | AsyncIterable<T>,
			options?: { signal: AbortSignal },
		): T;
	}
}
