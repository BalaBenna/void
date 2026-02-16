/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface SpeechRecognitionHandle {
	start: () => void;
	stop: () => void;
}

export interface SpeechRecognitionOptions {
	onResult: (transcript: string) => void;
	onEnd: () => void;
	onError: (error: string) => void;
	lang?: string;
	continuous?: boolean;
	interimResults?: boolean;
}

export function isSpeechRecognitionAvailable(): boolean {
	const w = window as any;
	return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function createSpeechRecognition(options: SpeechRecognitionOptions): SpeechRecognitionHandle | null {
	const w = window as any;
	const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;
	if (!SpeechRecognition) return null;

	const recognition = new SpeechRecognition();
	recognition.continuous = options.continuous ?? true;
	recognition.interimResults = options.interimResults ?? true;
	recognition.lang = options.lang ?? 'en-US';

	recognition.onresult = (event: any) => {
		let transcript = '';
		for (let i = event.resultIndex; i < event.results.length; i++) {
			if (event.results[i].isFinal) {
				transcript += event.results[i][0].transcript;
			}
		}
		if (transcript) {
			options.onResult(transcript);
		}
	};

	recognition.onerror = (event: any) => {
		options.onError(event.error || 'Unknown speech recognition error');
	};

	recognition.onend = () => {
		options.onEnd();
	};

	return {
		start: () => recognition.start(),
		stop: () => recognition.stop(),
	};
}
