import mitt from 'mitt';

const emitter = mitt();

export default emitter;
export enum Events {
	added_players_to_court = 'added_players_to_court',
	removed_players_from_court = 'removed_players_from_court',
	player_attendance_changed = 'player_attendance_changed',
	player_queue_state_changed = 'player_queue_state_changed',
	player_pause_state_changed = 'player_pause_state_changed',
}
