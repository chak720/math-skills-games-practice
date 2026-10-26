import type { Generator } from './types';
import { PROBABILITY } from './generators/probability';
import { COMBINATORICS } from './generators/combinatorics';
import { EV } from './generators/ev';
import { LOGIC } from './generators/logic';
import { BRAINTEASERS } from './generators/brainteasers';
import { MARKOV } from './generators/markov';

export const ALL_GENERATORS: Generator<unknown>[] = [...PROBABILITY, ...COMBINATORICS, ...EV, ...LOGIC, ...BRAINTEASERS, ...MARKOV];

export const generatorById = (id: string): Generator<unknown> | undefined => ALL_GENERATORS.find((g) => g.id === id);
