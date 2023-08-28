<template>
	<div>
		<v-dialog v-model="showRemoveConfirmation" persistent @esc="onClick(false)">
			<v-card>
				<v-card-title>Remove players back to Wait List?</v-card-title>
				<v-card-text v-for="player in players" :key="player">{{player.full_name}}</v-card-text>
				<v-card-actions>
					<v-button secondary @click="onClick(false)">Cancel</v-button>
					<v-button @click="onClick(true)">Confirm Remove</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
		<v-table
			class="queuelist-table"
			:headers="queueListHeaders"
			:items="playersSorted"
			fixed-header
			show-select="none"
			:row-height="30"
			inline>
			<template #[`header.level`]="{ header }">
				<v-button
					class="action-button"
					:small="true"
					icon
					@click="showRemoveConfirmation = !showRemoveConfirmation"
				>
					<v-icon name="close" />
				</v-button>
			</template>
			<template #[`item.full_name`]="{ item }">
				<div :class="getMemberClass(item)">{{ item.full_name }}</div>
			</template>
		</v-table>
	</div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, PropType, watch } from 'vue';
import { TableHeader, Player, MAX_PLAYER } from './types';
import { useCourtStore } from '../store/court';

export default defineComponent({
	props: {
		players: {
			type: Array as PropType<Player[]>,
			default: [],
		},
	},
	setup(props) {
		const queueListHeaders = ref<TableHeader[]>([
			{
				text: 'Queued',
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
		const showRemoveConfirmation = ref(false);
		const playersSorted = computed(() => {
			return props.players.sort((a, b) => {
				if (a.last_active < b.last_active) {
					return -1;
				}
				if (a.last_active > b.last_active) {
					return 1;
				}
				return 0;
			});
		});
		
		return {
			courtStore,
			queueListHeaders,
			showRemoveConfirmation,
			playersSorted,
			MAX_PLAYER,
			getMemberClass,
			onClick,
		};

		function getMemberClass(player: Player) {
			return player.member ? 'is-member' : 'non-member';
		}

		function onClick(confirmRemove: boolean = false) {
			if (confirmRemove) {
				courtStore.commitQueuedSessionPlayers(props.players, /*isQueueing = */ false);
			}
			showRemoveConfirmation.value = false;
		}
	},
});
</script>

<style lang="scss" scoped>
.queuelist-table {
	// Disable horizontal scroll, clamp to 100% width
	width: 100%;
	margin-top: 0.5em;
	overflow-x: hidden;
	--v-table-height: auto;
	--v-table-sticky-offset-top: 20;
	--v-table-color: var(--foreground-normal);
	--v-table-background-color: var(--background-subdued);
}

.non-member {
	color: var(--orange-75);
}

.action-button {
	--v-button-background-color: var(--danger);
	--v-button-background-color-hover: var(--danger-75);
}

</style>