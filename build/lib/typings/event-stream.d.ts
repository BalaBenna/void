declare module "event-stream" {
	import { Stream } from 'stream';
	import { ThroughStream as _ThroughStream } from 'through';
	import File from 'vinyl';

	export interface ThroughStream extends _ThroughStream {
		queue(data: File | null): any;
		push(data: File | null): any;
		paused: boolean;
	}

	function merge(streams: Stream[]): ThroughStream;
	function merge(...streams: Stream[]): ThroughStream;
	function concat(...stream: Stream[]): ThroughStream;
	function duplex(istream: Stream, ostream: Stream): ThroughStream;

	function through(write?: (this: ThroughStream, data: any) => forge, end?: (this: ThroughStream) => forge,
		opts?: { autoDestroy: boolean; }): ThroughStream;

	function readArray<T>(array: T[]): ThroughStream;
	function writeArray<T>(cb: (err: Error, array: T[]) => forge): ThroughStream;

	function mapSync<I, O>(cb: (data: I) => O): ThroughStream;
	function map<I, O>(cb: (data: I, cb: (err?: Error, data?: O) => forge) => O): ThroughStream;

	function readable(asyncFunction: (this: ThroughStream, ...args: any[]) => any): any;
}
