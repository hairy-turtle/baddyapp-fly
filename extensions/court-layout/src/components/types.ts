export type Alignment = 'left' | 'center' | 'right';

export type TableHeader = {
	text: string;
	value: string;
	description?: string | null;
	align?: Alignment;
	sortable?: boolean;
	width?: number | null;
	[key: string]: any;
};

export type Header = Required<TableHeader>;

export type Item = {
	[key: string]: any;
};

export type ItemSelectEvent = {
	value: boolean;
	item: Item;
};

export type Sort = {
	by: string | null;
	desc: boolean;
};

// Try to match the type of ht_directory to reduce the amount of type casting.
export type Player = {
	id: string;
	first_name: string;
	last_name: string;
	full_name: string;
	level: number;
	pause: boolean;
	member: boolean;
	last_active: Date;
};

// Constant maximum player allowed per court
export const MAX_PLAYER = 4;
export const MAX_COURTS = 12;
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;
export const SELECTABLE_WAIT_LIST_COUNT = 16;
export const INTERVAL_APP_REFRESH_MS = 5000;

export enum AppRefreshItem {
	Directory = 'Directory',	// Players directory from ht_directory
	Courts = 'Courts',			// Court details from ht_events
	Players = 'Players',		// Wait list and attendance from ht_session_players
}

export enum CourtState {
	Inactive = 'Inactive',
	InProgress = 'In-Progress',
	ConfirmComplete = 'Confirm-Complete',
	AwaitingSelection = 'Awaiting-Selection',
	SelectingPlayers = 'Selecting-Players',
}

export type CourtDetails = {
	number: number;
	state: CourtState;
	players: Array<Player>;
	// Active can potentially be computed but we want to allow court manipulation before start_time
	active: boolean; // Tells whether the court is set to active in database
	start_time: Date;
	end_time: Date;
};