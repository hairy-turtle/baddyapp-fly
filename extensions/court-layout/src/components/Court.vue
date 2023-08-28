<template>
	<div class="court-flex">
		<v-dialog v-model="confirmComplete" persistent @esc="onClick(false)">
			<v-card>
				<v-card-title>Complete Game for Court {{courtNumber}}</v-card-title>
				<v-card-text>Do you want to clear the court now?</v-card-text>
				<v-card-actions>
					<v-button secondary @click="onClick(false)">Keep playing</v-button>
					<v-button @click="onClick(true)">Confirm Complete</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
		<v-table
			class="court-table"
			:class="courtAgeClass"
			:headers="tableHeaders"
			:items="players"
			:row-height="tableRowHeight"
			no-items-text="Empty Court"
			inline>
			<template #[`header.full_name`]="{ header }">
				<div class="court-players-header">
					{{ header.text }}
					&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
					{{ elapsedTimer }}
				</div>
				<!-- TODO: Put buttons here instead to save vertical real estate -->
			</template>
			<template #[`header.level`]="{ header }">
				<v-button
					class="action-button"
					:class="buttonStatus"
					:disabled="!courtActive"
					:small="true"
					icon
					@click="onClick"
				>
					<v-icon :name="buttonIcon" />
				</v-button>
			</template>
			<template #[`item.full_name`]="{ item }">
				<div class="court-players-name" :class="getMemberClass(item)">
					{{ item.full_name }}
					<v-icon
						v-if="item.full_name !== ''"
						:class="getSwapClass(item)"
						:name="getSwapIcon(item)"
						@click="onSwapPlayer(item)"
					/>
				</div>
			</template>
		</v-table>
	</div>
</template>

<script lang="ts">
import { defineComponent, ref, toRefs, computed, PropType, watch } from 'vue';
import emitter, { Events } from '../store/events';
import { useApi } from '@directus/extensions-sdk';
import { useWindowSize } from './use-window-size';
// import Header from types.ts
import { CourtState, Player, MAX_PLAYER } from './types';
import { useCourtStore } from '../store/court';

export default defineComponent({
	props: {
		courtNumber: {
			type: Number,
			default: '1',
		},
		courtActive: {
			type: Boolean,
			default: false,
		},
		players: {
			type: Array as PropType<Player[]>,
			default: [],
		},
	},
	// emits: ['updated:courtState'],
	components: { },
	setup(props, { emit }) {
		const api = useApi();
		const courtStore = useCourtStore();
		const { width : windowWidth, height : windowHeight } = useWindowSize();
		const { courtActive } = toRefs(props);
		const confirmComplete = ref(false);
		const startTime = ref<Date | null>();
		const elapsedTimer = ref<string>('00:00');
		const timer =ref<number>(0);

		const tableHeaders = computed(() => {
			const headers = [
				{
					text: `Court ${props.courtNumber}`,
					value: 'full_name',
					sortable: false,
					width: windowWidth.value >= 2050 && windowHeight.value >= 1150 ? 260 : 200,
					align: 'left',
				},
				{
					text: 'Level',
					value: 'level',
					sortable: false,
					width: 90,
					align: 'left',
				},
			];
			return headers;
		});

		const buttonTitle = computed(() => {
			switch (courtStore.courtStates[props.courtNumber]?.state) {
				case CourtState.Inactive:
					return 'Court Inactive';
				case CourtState.AwaitingSelection:
					return 'Select Players';
				case CourtState.SelectingPlayers:
					return 'Cancel Selection';
				case CourtState.InProgress:
					return 'Complete Play';
				default:
					return 'Court Inactive';
			}
		});
		
		const buttonIcon = computed(() => {
			switch (courtStore.courtStates[props.courtNumber]?.state) {
				case CourtState.Inactive:
					return 'person_off';
				case CourtState.AwaitingSelection:
					return 'person_add_alt';
				case CourtState.SelectingPlayers:
					return 'person_remove';
				case CourtState.ConfirmComplete:
					return 'scoreboard';
				case CourtState.InProgress:
					return 'done';
				default:
					return 'person_off';
			}
		});

		const buttonStatus = computed(() => {
			switch (courtStore.courtStates[props.courtNumber]?.state) {
				case CourtState.Inactive:
					return 'inactive';
				case CourtState.AwaitingSelection:
					return 'idle';
				case CourtState.SelectingPlayers:
					return 'selecting';
				case CourtState.ConfirmComplete:
					return 'confirming';
				case CourtState.InProgress:
					return 'in-progress';
				default:
					return 'idle';
			}
		});

		const courtAgeClass = getCourtAgeClass();
		const tableRowHeight = computed(() => {
			return windowWidth.value >= 2050 && windowHeight.value >= 1150 ? 50 : 30;
		});

		emitter.on(Events.added_players_to_court, (courtNumber: number) => {
			if (courtNumber === props.courtNumber) {
				// If the court is transitioning to in-progress, then set the start time for this court
				if (startTime.value === undefined || startTime.value === null)
					startTime.value = new Date(Date.now());
			}
		});

		emitter.on(Events.removed_players_from_court, (courtNumber: number) => {
			if (courtNumber === props.courtNumber) {
				// console.log('removed_players_from_court, courtNumber: ', courtNumber);
				assignQueuedPlayersToAvailableCourts();
			}
		});

		watch(() => [courtActive.value, props.players, Object.values(courtStore.courtStates)], (_newVal, _oldVal) => {
			updateCourtState();
			updateTime();
		}, { immediate: true });

        // TODO: There is a bug where if there are multiple queued player groups,
        // completing a court will cause all groups of players to be assigned to that court.
		async function assignQueuedPlayersToAvailableCourts() {
			if (courtStore.queuedPlayersGroups.length > 0) {
				// For each player in the first group of queued players, add them to selected
				const queuedPlayers = courtStore.queuedPlayersGroups[0];
				if (queuedPlayers !== undefined && queuedPlayers.length > 0) {
					if (arePlayersOnCourt()) {
						console.log('There are still players on court. Cannot add queued players to court.')
						return;
					}

					await courtStore.addPlayersToCourt(props.courtNumber, queuedPlayers);
				}
			}
		}

		// These transitions are caused by the states of the court that is not caused by clicks.
		// These events may have occurred outside of the court, or just initial loading of court players.
		function updateCourtState() {
			let initialCourtState = courtStore.courtStates[props.courtNumber]?.state;
			let nextCourtState = initialCourtState;

			if (courtActive.value === false) {
				nextCourtState = CourtState.Inactive;
			}
			else if (arePlayersOnCourt()) {
				nextCourtState = CourtState.InProgress;

				updateTime();
			}
			else if (props.players.length === 0) {
				nextCourtState = CourtState.AwaitingSelection;
			}
			else {
				nextCourtState = CourtState.AwaitingSelection;
			}

			if (initialCourtState !== nextCourtState) {
				const courtDetail = courtStore.courtStates[props.courtNumber];
				if (courtDetail !== undefined) {
					courtDetail.state = nextCourtState;
				}
			}
		}
		
		// When courtEvents have been updated, infer the start time for all courts if players are on court
		watch(() => [courtStore.courtEvents], (_newVal, _oldVal) => {
			loadCourtCurrentGameStartTime();
		}, { immediate: true });

		function updateTime() {
			const courtDetail = courtStore.courtStates[props.courtNumber];
			if (startTime.value === undefined || startTime.value === null) return;
			if (courtDetail === undefined
				|| (courtDetail.state != CourtState.InProgress
				&& courtDetail.state != CourtState.ConfirmComplete)) return;

			timer.value = requestAnimationFrame(updateTime);
			const elapsed = new Date(Date.now() - startTime.value!.getTime());
			var mins = elapsed.getMinutes();
			var secs = elapsed.getSeconds();
			elapsedTimer.value = padWithZero(mins, 2) + " : " + padWithZero(secs, 2);
		};

		function stopAndResetTimer() {
			clearInterval(timer.value);
			elapsedTimer.value = '00:00';
			startTime.value = null;
		}
		
		function padWithZero(x: number, size: number) {
			let num = x.toString();
			while (num.length < size) num = "0" + num;
			return num;
		}

		function getCourtAgeClass() {
			const courtAgeClass = ref(recalculateCourtAgeClass());

			setInterval(() => {
				courtAgeClass.value = recalculateCourtAgeClass();
			}, 1000); // Update more frequently than the minute

			watch(() => [props.players, startTime.value], () => {
				courtAgeClass.value = recalculateCourtAgeClass();
			});
			
			return courtAgeClass;
			
			function recalculateCourtAgeClass() {
				if (courtStore.courtStates[props.courtNumber]?.state != CourtState.InProgress)
					return '';

				var mins = 0;

				if (startTime.value !== undefined && startTime.value !== null) {
					// Get court age from elapsed time, by minute
					const elapsed = new Date(Date.now() - startTime.value!.getTime());
					var mins = elapsed.getMinutes();
					// Clamp mins to min of 0, max of 15. This matches the CSS styles
					//  below with 15 gradients since games don't usually go beyond 15 minutes.
					mins = Math.max(0, Math.min(15, mins));
					//console.log(`Updating court ${props.courtNumber} age class: court-age-` + mins)
				}

				return 'court-age-' + mins;
			}
		}

		function arePlayersOnCourt() {
			// No players are considered to be on the court if all players have empty full_name
			const emptyNamePlayersFound = props.players.some(player => player.full_name !== '');
			const maxPlayersOnCourt = props.players.length === MAX_PLAYER;
			const courtHasUnfinishedPlayers = courtStore.courtEvents.filter(ht_event => 
				ht_event.court === props.courtNumber.toString()
				&& ht_event.session === courtStore.selectedSessionId
				&& ht_event.date_updated === null).length > 0;
			
			return emptyNamePlayersFound && maxPlayersOnCourt && courtHasUnfinishedPlayers;
		}

		function getMemberClass(player: Player) {
			const playerIsSwappingOut = courtStore.playerToSwapOut !== null && courtStore.playerToSwapOut.id === player.id;
			if (playerIsSwappingOut)
				return 'swap-player';
			else
				return player.member ? 'is-member' : 'non-member';
		}

		function getSwapClass(player: Player) {
			const playerIsSwappingOut = courtStore.playerToSwapOut !== null && courtStore.playerToSwapOut.id === player.id;
			if (playerIsSwappingOut)
				return 'swap-button-on';
			else
				return 'swap-button-off';
		}

		function getSwapIcon(player: Player) {
			const playerIsSwappingOut = courtStore.playerToSwapOut !== null && courtStore.playerToSwapOut.id === player.id;
			if (playerIsSwappingOut)
				return 'cancel';
			else
				return 'swap_horiz';
		}

		async function loadCourtCurrentGameStartTime() {
			// NOTE: This method should only be called after refreshCourtEvents have been called!!
			// Get the events for the court where date_updated is null
			const courtEventsForCourt = courtStore.courtEvents.filter(ht_event => 
				ht_event.court === props.courtNumber.toString()
				&& ht_event.date_updated === null);
			
			// If any events are found, then the game is in progress, use that as the start time
			if (courtEventsForCourt.length > 0) {
				startTime.value = new Date(courtEventsForCourt[0]!.date_created);
			}
			// If no events are found, then the game is not in progress
			else {
				startTime.value = null;
			}
		}

		return {
			buttonTitle,
			buttonIcon,
			buttonStatus,
			tableHeaders,
			tableRowHeight,
			courtAgeClass,
			// selectedPlayers, changeManualSort, refreshCourtPlayers,
			elapsedTimer,
			courtActive,
			onClick,
			confirmComplete,
			updateCourtState,
			courtStore,
			getMemberClass,
			onSwapPlayer,
			getSwapClass,
			getSwapIcon,
		};

		// These are transitions that are caused by the button belonging to this court.
		// So, for example, confirming selection in WaitList will not cause this to trigger.
		// Hence, there's no state changes into CourtState.InProgress.
		// onClick receives a default action of true, which means that the button will perform its default action.
		// If the button is clicked and the default action is false, then the button will not perform its default action.
		function onClick(defaultAction: boolean = true) {
			// If player is being swapped out, remove the intention to swap out
			if (courtStore.playerToSwapOut !== null) {
				courtStore.playerToSwapOut = null;
				courtStore.playerToSwapCourtNumber = null;
				return;
			}

			let courtDetail = courtStore.courtStates[props.courtNumber];

			if (courtDetail !== undefined) {
				let initialCourtState = courtDetail.state;
				let nextCourtState = initialCourtState;

				switch (initialCourtState) {
					case CourtState.AwaitingSelection:
						nextCourtState = CourtState.SelectingPlayers;
						courtStore.removePlayersFromCourt(props.courtNumber);
						break;
					case CourtState.SelectingPlayers:
						nextCourtState = CourtState.AwaitingSelection;
						courtStore.removePlayersFromCourt(props.courtNumber);
						break;
					case CourtState.InProgress:
						nextCourtState = CourtState.ConfirmComplete;
						confirmComplete.value = true;
						break;
					case CourtState.ConfirmComplete:
						if (defaultAction) {
							// Confirm court game is completed
							nextCourtState = CourtState.AwaitingSelection;
							courtStore.removePlayersFromCourt(props.courtNumber);
							confirmComplete.value = false;
							stopAndResetTimer();
						}
						else {
							// Cancel confirmation (accidental clicks)
							nextCourtState = CourtState.InProgress;
							confirmComplete.value = false;
						}
						
						break;
					case CourtState.Inactive:
					default:
						break;
				}
	
				if (nextCourtState !== initialCourtState) {
					courtDetail.state = nextCourtState;
				}
			}
		}

		function onSwapPlayer(player: Player) {
			if (courtStore.playerToSwapOut === null) {
				// Initiate swap
				courtStore.playerToSwapOut = player;
				courtStore.playerToSwapCourtNumber = props.courtNumber;
			}
			else {
				// Cancel swap
				courtStore.playerToSwapOut = null;
				courtStore.playerToSwapCourtNumber = null;
			}
		}
	},
	watch: {
	},
});
</script>

<style lang="scss" scoped>

.court-flex {
	height: 100%;
	width: 100%;
	flex-shrink: 1;
	overflow-x: hidden;
}

.court-table {
	overflow-x: hidden;	
	margin-bottom: 0.5em;
	margin-right: 0.5em;
}

$green: #ccf4cc;
$red: #b15a5a;
@for $i from 0 through 15 {
	.court-age-#{$i} {
		$perc: calc($i / 15) * 100;
		border: 2px solid mix($red, $green, $weight: $perc * 1%);
	}
}

.action-button {
	&.inactive {
		--v-button-background-color: var(--primary-alt);
		--v-button-background-color-hover: var(--primary-alt-75);
	}
	&.idle {
		--v-button-background-color: var(--primary-110);
		--v-button-background-color-hover: var(--primary-75);
	}
	&.selecting {
		--v-button-background-color: var(--danger);
		--v-button-background-color-hover: var(--danger-75);
	}
	&.confirming {
		--v-button-background-color: var(--warning);
		--v-button-background-color-hover: var(--warning-75);
	}
	&.in-progress {
		--v-button-background-color: var(--success);
		--v-button-background-color-hover: var(--success-75);
	}
}
.non-member {
	color: var(--orange-75);
}

.swap-button-off {
	color: transparent;
}
.swap-button-on {
	color: var(--background-inverted);
}
.swap-button-off:hover {
	color: var(--background-inverted);
}
.swap-button-on:hover {
	color: var(--background-inverted);
}

.swap-player {
	color: red;
}

.court-table, .court-players-header, .court-players-name {
	// Large font for extra-large screens (Desktop) with 4 columns, match CourtLayout config for min-width
	@media (min-width: 2050px) and (min-height: 1150px) {
		font-size: 1.2em;
	}
}

</style>