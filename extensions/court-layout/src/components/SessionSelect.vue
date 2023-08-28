<template>
    <div>
        <!-- <v-notice type="info"><b>Please select the session before updating attendance. Leaving page or selecting a new session commits the attendance.</b></v-notice> -->
        <v-select
            class="select-session"
            v-model="courtStore.selectedSessionId"
            :items="sessionSelections"
            placeholder="Select Session"
            item-text="display_text"
            item-value="id"
            @update:model-value="onSelect"
            />
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue';
import { useItems } from '@directus/extensions-sdk';
import { useCourtStore } from '../store/court';

export default defineComponent({
    props: { },
	components: { },
	setup(props, { emit }) {
        const courtStore = useCourtStore();

		const { items: availableSessions } = useItems(
			ref('ht_session'),
			{
				sort: computed(() => ['start_datetime']),
				page: ref(1),
				limit: ref(10),
				fields: computed(() => ['id', 'session_date', 'start_datetime', 'end_datetime', 'court_allocation']),
				filter: computed(() => ({
                    end_datetime: {
                        _gte: new Date().toISOString(),
                    },
                })),
				search: ref(),
			},
			true
		);

        const sessionSelections = computed(() => {
            // Only items with end_datetime in the future are valid
            const ret = availableSessions.value.filter(availableSession => {
                const end_datetime = new Date(availableSession.end_datetime);
                const now = new Date();
                return end_datetime > now;
            });
            const sessionSelections = new Array();
            ret.forEach(availableSession => {
                const date = new Date(availableSession.session_date);
                const start = new Date(availableSession.start_datetime);
                const end = new Date(availableSession.end_datetime);
                sessionSelections.push({
                    ...availableSession,
                    display_text:
                        date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }) + ' (' +
                        start.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }) + ' - ' +
                        end.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }) + ')'
                })
            });
            return sessionSelections.sort((a, b) => (a.session_date > b.session_date) ? 1 : -1);
        });

        // Watch items for changes, and if updated, we update the default session ID
        watch(availableSessions, async () => {
            const getDefaultSessionId = async () => {
                // Get the first session in the future
                const session = availableSessions.value.find(availableSession => {
                    const end_datetime = new Date(availableSession.end_datetime);
                    const now = new Date();
                    return end_datetime > now;
                });
                return session ? session.id : null;
            };

            getDefaultSessionId().then(sessionId => {
                if (sessionId)
                    onSelect(sessionId);
            });

            // Safeguard feature: Mark all historical events as updated
            const getPreviousSessionId = async () => {
                // Get the last session in the past
                const session = availableSessions.value.reverse().find(availableSession => {
                    const end_datetime = new Date(availableSession.end_datetime);
                    const now = new Date();
                    return end_datetime < now;
                });
                return session ? session.end_datetime : null;
            };

            getPreviousSessionId().then(previousSessionEndDatetime => {
                if (previousSessionEndDatetime)
                    courtStore.markHistoricalEventsAsUpdated(previousSessionEndDatetime);
            });
        });

		return {
            courtStore,
			availableSessions,
			sessionSelections, onSelect
		};

		function onSelect(session_id: string) {
            courtStore.selectedSessionId = session_id;
		}
	},
});
</script>

<style scoped>
.wordwrap { 
    white-space: pre-wrap;
}

/* Override the default input height variable for select-session class to 45px */
.select-session {
    --input-height: 45px;
}

</style>