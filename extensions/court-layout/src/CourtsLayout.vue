<template>
	<div class="layout-container">
		<div class="left-panel align-items-center">
			<!-- Wait list and attendance -->
			<div class="mb-2">
				<SessionSelect />
			</div>
			<v-tabs class="mb-2" v-model="activeTab">
				<v-tab value="wait-list">Wait List</v-tab>
				<v-tab value="attendance">Attendance</v-tab>
			</v-tabs>
			
			<v-tabs-items v-model="activeTab">
				<v-tab-item value="wait-list">
					<div>
						<WaitList />
					</div>
				</v-tab-item>
				<v-tab-item value="attendance">
					<div>
						<PlayersAttendanceList />
					</div>
				</v-tab-item>
			</v-tabs-items>
		</div>
		<div class="queue-list">
			<v-notice class="mb-2" type="info" v-if="courtStore.queuedPlayersGroups.length === 0">
				<b>No players queued</b>
			</v-notice>
			<div class="queue-item" v-for="playerGroup in courtStore.queuedPlayersGroups" :key="playerGroup">
				<QueueList
					:players="playerGroup"/>
			</div>
		</div>
		<div class="court-container align-items-center">
			<div class="individual-court" v-for="n in 12" :key="n">
				<Court
					:courtNumber="n"
					:courtActive="courtStore.activeCourts.includes(n)"
					:players="courtStore.courtStates[n]?.players" />
			</div>
		</div>
	</div>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from 'vue';
import QueueList from './components/QueueList.vue';
import SessionSelect from './components/SessionSelect.vue';
import WaitList from './components/WaitList.vue';
import Court from './components/Court.vue';
import PlayersAttendanceList from './components/PlayersAttendanceList.vue';
import { useCourtStore } from './store/court';
import { AppRefreshItem } from './components/types';

export default defineComponent({
	components: { SessionSelect, WaitList, QueueList, Court, PlayersAttendanceList },
	setup() {
		const courtStore = useCourtStore();
		const activeTab = ref(['wait-list']);
		const colors = ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'light', 'dark'];

		watch(() => [activeTab.value], () => {
			if (activeTab.value.includes('attendance')) {
				courtStore.pauseAppRefreshItem(AppRefreshItem.Players);
				courtStore.pauseAppRefreshItem(AppRefreshItem.Directory);
			} else {
				courtStore.resumeAppRefreshItem(AppRefreshItem.Players);
				courtStore.resumeAppRefreshItem(AppRefreshItem.Directory);
			}
		});

		return {
			// Extension store
			courtStore,
			// Left panel Wait List
			activeTab, 
			// Temporary helpers for debugging
			colors,
		};
	},
});
</script>

<!-- Note: Don't import bootstrap in script tag, as it leaks to global css -->
<style lang="scss">

.layout-container {
	display: grid;
	
	// Default to only 1 column on small screens
	grid-template-columns: 1fr;

	@media (min-width: 768px) { // large screens (iPad Air 1180w to iPad Pro 1366w)
		grid-template-columns: minmax(330px, 0.6fr) 3fr;
	}
	// From 1367 and beyond, allow queue list to be in its own column.
	// This must match exactly WaitList for when the queue list is hidden.
	@media (min-width: 1367px) { // extra-large screens (Large tablet)
		grid-template-columns: minmax(330px, 0.6fr) minmax(300px, 0.6fr) 3fr;
	}
	grid-gap: 20px; // add some space between the columns

	.left-panel {
		width: 100%;
		height: 100%;
		overflow-y: hidden;
	}

	.queue-list {
		width: 100%;
		height: 100%;
		overflow-y: auto;
		overscroll-behavior: contain;
		// 60px = header height
		max-height: calc(95vh - 60px);

		.queue-item {
			margin-bottom: 0.5em;
		}

		// This must match exactly WaitList for when the queue list is hidden (minus 1px for max-width instead of min-width).
		@media (max-width: 1366px) { // mobile, to large iPad Pro
			width: 0;
			height: 0;
			display: none;
		}
	}

	.court-container {
		width: 100%;
		display: grid;
		height: calc(95vh - 60px);

		grid-template-columns: repeat(1, minmax(min-content, 1fr)); // default to 1 column on small screens

		@media (min-width: 768px) { // medium screens (mobile)
		  grid-template-columns: repeat(2, minmax(min-content, 1fr));
		}
		@media (min-width: 1180px) { // large screens (iPad Air 1180w to iPad Pro 1366w)
		  grid-template-columns: repeat(3, minmax(min-content, 1fr));
		}
		@media (min-width: 1367px) { // extra-large screens (Large tablet). Dropping to 2 because collection navigation is now visible
		  grid-template-columns: repeat(2, minmax(min-content, 1fr));
		}
		@media (min-width: 1720px) { // extra-large screens (Large tablet). Increasing back to 3 with sufficient width
		  grid-template-columns: repeat(3, minmax(min-content, 1fr));
		}
		@media (min-width: 2050px) { // extra-large screens (Desktop)
		  grid-template-columns: repeat(4, minmax(min-content, 1fr));
		}
	
		.individual-court {
			// make the parent container div shrink-wrap around its child size
  			display: inline-grid;
			flex-wrap: wrap;
		}
	}
}

</style>