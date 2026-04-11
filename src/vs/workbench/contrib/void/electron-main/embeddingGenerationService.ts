/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { EmbeddingRequest, EmbeddingResponse, IEmbeddingGenerationService } from '../common/embeddingsTypes.js';

export class EmbeddingGenerationService implements IEmbeddingGenerationService {
	readonly _serviceBrand: undefined;

	private _localModel: any = null;
	private _localTokenizer: any = null;
	private _localModelLoading: Promise<void> | null = null;

	async generateEmbeddings(request: EmbeddingRequest, apiKey: string): Promise<EmbeddingResponse> {
		if (request.provider === 'none') {
			throw new Error('No embedding provider configured');
		}

		if (request.provider === 'local') {
			return this._generateLocalEmbeddings(request);
		}

		if (request.provider === 'openAI') {
			if (!apiKey) throw new Error('No API key configured for OpenAI embeddings');
			return this._generateOpenAIEmbeddings(request, apiKey);
		}

		throw new Error(`Unsupported embedding provider: ${request.provider}`);
	}

	private async _ensureLocalModelLoaded(): Promise<void> {
		if (this._localModel && this._localTokenizer) return;
		if (this._localModelLoading) {
			await this._localModelLoading;
			return;
		}

		this._localModelLoading = (async () => {
			try {
				// Use dynamic import for @xenova/transformers (optional runtime dep)
				// @ts-ignore - @xenova/transformers is loaded at runtime
				const { pipeline } = await import('@xenova/transformers');
				const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
					quantized: true, // Use quantized model for faster inference
				});
				this._localModel = extractor;
			} catch (e) {
				console.warn('Failed to load local embedding model, falling back to simple embeddings:', e);
				this._localModel = null;
			}
		})();

		await this._localModelLoading;
		this._localModelLoading = null;
	}

	private async _generateLocalEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
		await this._ensureLocalModelLoaded();

		if (this._localModel) {
			// Use the transformer model
			const embeddings: number[][] = [];
			for (const text of request.texts) {
				const output = await this._localModel(text, { pooling: 'mean', normalize: true });
				embeddings.push(Array.from(output.data as Float32Array));
			}
			return { embeddings };
		}

		// Fallback: simple TF-IDF-like embeddings when transformer model unavailable
		return this._generateSimpleEmbeddings(request.texts);
	}

	private _generateSimpleEmbeddings(texts: string[]): EmbeddingResponse {
		const DIMENSION = 128;
		const embeddings: number[][] = [];

		// Build vocabulary from all texts
		const vocab = new Map<string, number>();
		let vocabIdx = 0;
		for (const text of texts) {
			const tokens = text.toLowerCase().split(/\W+/).filter(t => t.length > 1);
			for (const token of tokens) {
				if (!vocab.has(token)) {
					vocab.set(token, vocabIdx++ % DIMENSION);
				}
			}
		}

		for (const text of texts) {
			const vec = new Float64Array(DIMENSION);
			const tokens = text.toLowerCase().split(/\W+/).filter(t => t.length > 1);
			const tokenCounts = new Map<string, number>();

			for (const token of tokens) {
				tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
			}

			for (const [token, count] of tokenCounts) {
				const idx = vocab.get(token);
				if (idx !== undefined) {
					// TF component
					const tf = count / tokens.length;
					vec[idx] += tf;
				}
			}

			// Normalize
			let norm = 0;
			for (let i = 0; i < DIMENSION; i++) norm += vec[i] * vec[i];
			norm = Math.sqrt(norm) || 1;
			const normalized = Array.from(vec).map(v => v / norm);

			embeddings.push(normalized);
		}

		return { embeddings };
	}

	private async _generateOpenAIEmbeddings(request: EmbeddingRequest, apiKey: string): Promise<EmbeddingResponse> {
		const response = await fetch('https://api.openai.com/v1/embeddings', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				model: request.model || 'text-embedding-3-small',
				input: request.texts,
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`OpenAI embedding API error: ${response.status} ${error}`);
		}

		const data = await response.json();
		const embeddings = data.data
			.sort((a: any, b: any) => a.index - b.index)
			.map((item: any) => item.embedding as number[]);

		return { embeddings };
	}
}
