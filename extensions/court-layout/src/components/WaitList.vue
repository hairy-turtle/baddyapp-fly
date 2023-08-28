<template>
	<div>
		<div class="mb-2 w-100">
			<v-button
				class="confirm-button"
				v-tooltip.bottom="`Confirm selected players`"
				:disabled="!confirmButtonEnabled"
				:small="true"
				icon
				@click="confirmSelectedPlayers"
			>
				<v-icon name="done_all" />
			</v-button>
			<v-button
				class="suggest-button"
				v-tooltip.bottom="`Smart suggest players`"
				:disabled="selectedPlayers.length === MAX_PLAYER || !isSelectMode || mandatoryPlayers.length === 0"
				:small="true"
				icon
				@click="suggestSelectedPlayers"
			>
				<v-icon name="lightbulb" />
			</v-button>
			<v-button
				class="queue-button"
				:class="{ 'cancel-queue-mode': isQueueSelectMode }"
				v-tooltip.bottom="`Queue next court players`"
				:disabled="!enableQueueSelectButton"
				:small="true"
				icon
				@click="isQueueSelectMode = !isQueueSelectMode"
			>
				<v-icon name="playlist_add_circle" />
			</v-button>
			<v-button
				class="assign-all-button"
				v-tooltip.bottom="`Assign players to available courts`"
				:disabled="!enableAssignAllButton"
				:small="true"
				icon
				@click="assignPlayersToAvailableCourts"
			>
				<v-icon name="double_arrow" />
			</v-button>
		</div>
		<div class="waitlist-container">
			<div class="queue-tables" :class="{ 'is-close': isQueueSelectMode }">
				<div v-if="!isQueueSelectMode">
					<div v-for="n in courtStore.queuedPlayersGroups" :key="n">
						<QueueList 
							:players="n"/>
					</div>
				</div>
			</div>
			<v-table
				class="waitlist-table"
				:headers="waitListHeaders"
				:items="waitListNotQueued"
				no-items-text="No player in waitlist"
				fixed-header
				v-model="selectedPlayers"
				show-select="none"
				:row-height="30"
				>
				<template #[`item.action-icon`]="{ item }">
					<WaitListActionButton
						:player="item"
						:isSelectMode="isSelectMode || isSwapMode"
						:swapMode="isSwapMode"
						:disabled="item.pause"
						:selected="isSelected.get(item.id)"
						:mandatoryPlayers="mandatoryPlayers"
						:selectable="playerIsSelectable(item)"
						@on-checkbox-changed="onCheckboxChanged"
						@on-pause-changed="recalculateMandatoryPlayers"
						/>
				</template>
				<template #[`item.full_name`]="{ item }">
					<div :class="[getMemberClass(item), getSelectableClass(item)]">{{ item.full_name }}</div>
				</template>
			</v-table>
		</div>
	</div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue';
import { AppRefreshItem, TableHeader, Player, MAX_PLAYER, CourtState, SELECTABLE_WAIT_LIST_COUNT, MAX_COURTS } from './types';
import { useCourtStore } from '../store/court';
import WaitListActionButton from './WaitListActionButton.vue';
import QueueList from './QueueList.vue';

export default defineComponent({
	props: { },
	components: { WaitListActionButton, QueueList },
	setup(_props) {
		const waitListHeaders = ref<TableHeader[]>([
			{
				text: 'Action',
				value: 'action-icon',
				sortable: false,
				width: 36,
				align: 'left',
			},
			{
				text: 'Waitlist',
				value: 'full_name',
				sortable: false,
				width: 200,
				align: 'left',
			},
			{
				text: 'Level',
				value: 'level',
				sortable: false,
				width: 90,
				align: 'left',
			},
		]);

		const courtStore = useCourtStore();
		const selectedPlayers = ref<Array<Player>>([]);
		const isQueueSelectMode = ref<boolean>(false);
		const isSwapMode = computed(() => courtStore.playerToSwapOut !== null);
		const isSelectMode = computed(() => courtStore.courtInSelectMode !== null || isQueueSelectMode.value);
		const waitListNotQueued = computed(() => {
			const playersWaitingToBeQueue = courtStore.waitList.filter((player) => player.queued_at === null);

			// Sort waitlist by the last_active datetime, with player who has not played before at the top
			playersWaitingToBeQueue.sort((a, b) => {
				if (a.last_active === null && b.last_active === null) {
					return 0;
				}
				if (a.last_active === null) {
					return -1;
				}
				if (b.last_active === null) {
					return 1;
				}
				return new Date(a.last_active).getTime() - new Date(b.last_active).getTime();
			});

			return playersWaitingToBeQueue;
		});
		const anyCourtAwaitingSelection = computed(() => {
			return Object.values(courtStore.courtStates).some((courtDetails) => courtDetails.state === CourtState.AwaitingSelection);
		});
		const sufficientPlayersOnWaitList = computed(() => {
			return waitListNotQueued.value.length >= MAX_PLAYER;
		});
		const enableAssignAllButton = computed(() => {
			return anyCourtAwaitingSelection.value && sufficientPlayersOnWaitList.value;
		});
		const enableQueueSelectButton = computed(() => {
			return sufficientPlayersOnWaitList.value && !courtStore.courtInSelectMode;
		});
		const confirmButtonEnabled = computed(() => {
			if (isSelectMode.value && selectedPlayers.value.length === MAX_PLAYER) {
				return true;
			}
			if (isSwapMode.value && courtStore.playerToSwapIn !== null) {
				return true;
			}
			return false;
		});

		// Create reference to array of unique player ids to selected flag
		const isSelected = computed(() => {
			const selectedPlayersIds = selectedPlayers.value.map(p => p.id);
			const selectedPlayersMap = new Map<string, boolean>();
			waitListNotQueued.value.forEach(p => {
				selectedPlayersMap.set(p.id, selectedPlayersIds.includes(p.id));
			});
			return selectedPlayersMap;
		});

		const mandatoryPlayers = ref<Array<Player>>([]);
		const suggestedPlayers = ref<Array<Player>>([]);

		watch(() => [waitListNotQueued.value], recalculateMandatoryPlayers, { immediate: true });
		watch(() => [mandatoryPlayers.value, courtStore.courtInSelectMode, isQueueSelectMode.value], () => {
			
			// For each mandatory players, add them to selected
			if (selectedPlayers.value.length === 0 &&
				(courtStore.courtInSelectMode !== null || isQueueSelectMode.value)) {
					// Special case: If mandatory player is not found in the selectedPlayers,
					// we will destroy the currently selected players to ensure that the mandatory players is in the list.
					if (mandatoryPlayers.value.some((player) => !selectedPlayers.value.includes(player))) {
						selectedPlayers.value = [];

						for (const player of mandatoryPlayers.value) {
							addPlayerToSelected(player);
						}
					}
			}
		});
		watch(() => [isSelectMode.value], () => {
			if (isSelectMode.value || isQueueSelectMode.value) {
				courtStore.pauseAppRefreshItem(AppRefreshItem.Players);
			} else {
				courtStore.resumeAppRefreshItem(AppRefreshItem.Players);
			}
		});
		
		return {
			courtStore,
			waitListHeaders,
			waitListNotQueued,
			selectedPlayers,
			confirmSelectedPlayers,
			suggestSelectedPlayers,
			assignPlayersToAvailableCourts,
			MAX_PLAYER,
			onCheckboxChanged,
			isSelected,
			mandatoryPlayers,
			suggestedPlayers,
			enableAssignAllButton,
			enableQueueSelectButton,
			isPlayerMandatory,
			recalculateMandatoryPlayers,
			getMemberClass,
			getSelectableClass,
			playerIsSelectable,
			isSwapMode,
			isSelectMode,
			confirmButtonEnabled,
			isQueueSelectMode,
		};

		// Player is only selectable if it is not paused and up to SELECTABLE_WAIT_LIST_COUNT players
		function playerIsSelectable(player: Player) {
			const playerIndex = waitListNotQueued.value.findIndex(p => p.id === player.id);
			return !player.pause && playerIndex < SELECTABLE_WAIT_LIST_COUNT;
		}

		function confirmSelectedPlayers() {
			if (isSwapMode.value) {
				courtStore.confirmSwapPlayers();
				return;
			}
			else if (isQueueSelectMode.value && !anyCourtAwaitingSelection.value) {
				courtStore.commitQueuedSessionPlayers(selectedPlayers.value);
				isQueueSelectMode.value = false;
				selectedPlayers.value = [];
				mandatoryPlayers.value = [];
				return;

			}
			else if (courtStore.courtInSelectMode !== null || getNextAvailableCourt() !== undefined) {
				const courtToAssignPlayers = courtStore.courtInSelectMode ?? getNextAvailableCourt();
				courtStore.addPlayersToCourt(courtToAssignPlayers, selectedPlayers.value);
				isQueueSelectMode.value = false;
				selectedPlayers.value = [];
				mandatoryPlayers.value = [];
			}
		}

		function getNextAvailableCourt() {
			const availableCourt = Object.values(courtStore.courtStates).find((courtDetails) => courtDetails.state === CourtState.AwaitingSelection || courtDetails.state === CourtState.SelectingPlayers);
			if (availableCourt === undefined) {
				throw new Error('No available court found');
			}
			return availableCourt.number;
		}

		function suggestSelectedPlayers() {
			const unpausedPlayers = waitListNotQueued.value.filter(p => !p.pause);

			if (waitListNotQueued.value.length === 0) return; // Wait list may be all paused
			if (unpausedPlayers.length === 0) return; // All players are paused
			if (!sufficientPlayersOnWaitList.value) return; // If not enough players for a court
			if (mandatoryPlayers.value.length === 0) return; // If no mandatory players

			// First, add the mandatory players to suggested players
			suggestedPlayers.value = mandatoryPlayers.value.slice();
			const nextPlayerLevel = suggestedPlayers.value[0]?.level ?? 5;

			// Get the next X players in the waitlist which should be based on last played time.
			const nextXPlayers = unpausedPlayers.slice(0, SELECTABLE_WAIT_LIST_COUNT);

			// Add players selectedPlayers based on levels closest to next player's level, until MAX_PLAYER is reached.
			// But first, sort nextXPlayers based on the difference between player's level and nextPlayerLevel
			let sortedNextXPlayers = nextXPlayers.sort((a: Player, b: Player) => {
				const aDiff = Math.abs(a.level - nextPlayerLevel);
				const bDiff = Math.abs(b.level - nextPlayerLevel);
				return aDiff - bDiff;
			});

			for (const player of sortedNextXPlayers) {
				if (suggestedPlayers.value.length >= MAX_PLAYER) break;
				if (!suggestedPlayers.value.some(p => p.id === player.id)) {
					suggestedPlayers.value.push(player);

					if (suggestedPlayers.value.length === MAX_PLAYER) break;
				}
			}

			for (const player of suggestedPlayers.value) {
				addPlayerToSelected(player);
			}
		}

		async function assignPlayersToAvailableCourts() {
			// Loop through each court and assign players to it if the state is AwaitingSelection
			for (let i = 1; i <= MAX_COURTS; i++) {
				const courtDetail = courtStore.courtStates[i];
				if (courtDetail && courtDetail.state === CourtState.AwaitingSelection) {
					suggestSelectedPlayers();
					await courtStore.addPlayersToCourt(i, selectedPlayers.value);
					selectedPlayers.value = [];
				}
			}
		}

		function onCheckboxChanged(player: Player, checked: boolean) {
			if (isSwapMode.value) {
				courtStore.playerToSwapIn = player;
			}
			else {
				// If player is not paused, add player to selectedPlayers
				if (!player.pause && checked)
					addPlayerToSelected(player);
				else
					removePlayerFromSelected(player);
			}
		}

		function addPlayerToSelected(player: Player) {
			// Push if not already in selectedPlayers
			if (!selectedPlayers.value.some(p => p.id === player.id)) {
				selectedPlayers.value.push(player);
			}
		}

		function removePlayerFromSelected(player: Player) {
			selectedPlayers.value = selectedPlayers.value.filter(p => p.id !== player.id);
		}

		function isPlayerMandatory(player: Player) {
			return mandatoryPlayers.value.some(p => p.id === player.id);
		}

		function recalculateMandatoryPlayers() {
			mandatoryPlayers.value = [];

			if (waitListNotQueued.value.length > 0) {
				// Get the first player that is not paused
				const firstUnpausedPlayer = waitListNotQueued.value.find(p => !p.pause);
				if (firstUnpausedPlayer) {
					mandatoryPlayers.value.push(firstUnpausedPlayer);
				}

				// TODO: Handle where players must play together.
				// In which case the mandatory players will be more than one.
			}
		}

		function getMemberClass(player: Player) {
			return player.member ? 'is-member' : 'non-member';
		}

		function getSelectableClass(player: Player) {
			return playerIsSelectable(player) ? '' : 'non-selectable';
		}
	},
});
</script>

<style lang="scss" scoped>
.confirm-button {
	margin-right: 0.5rem;
}

.suggest-button {
	margin-right: 0.5rem;
}

.queue-button {
	margin-right: 0.5rem;
	
	&.cancel-queue-mode {
		--v-button-background-color: var(--danger);
		--v-button-background-color-hover: var(--danger-75);
	}
}

.assign-all-button {
	float: right;
}

.waitlist-container :deep(.queue-tables) {
	display: flex;
	// For large tablet and beyond, hide it in waitlist as it will have its own column.
	// This must match exactly the value in CourtLayout queue-list and layout-container.
	@media (min-width: 1367px) {
		height: 0;
		display: none;
	}
}

// Don't show header in queue list if nested in waitlist to save some space.
.waitlist-container :deep(.table-header) {
	display: none;
}

// TODO: These aren't working yet. Animate queue list out of sight.
.waitlist-container :deep(.is-close) {
	transform: translateY(-100%);
}

.waitlist-container {
	overflow-y: auto;
	overscroll-behavior: contain;
	// Disable horizontal scroll, clamp to 100% width
	width: 100%;
	overflow-x: hidden;

	position: relative;
	// 60px = header height
	// 45px = session selector
	// 38px = left panel tabs
	max-height: calc(95vh - 60px - 45px - 38px);
}

.waitlist-table {
	overflow-x: hidden;
}

.non-member {
	color: var(--orange-75);
}

.non-selectable {
	opacity: 0.7;
}

</style>