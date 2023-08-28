<template>
    <div>
        <v-list-item @click="toggle(player.id, !attending)">
            <v-checkbox
                :model-value="attending"
                :label="player.full_name"
                @update:model-value="toggle(player.id, $event)">
            </v-checkbox>
        </v-list-item>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue';
import { useCourtStore } from '../store/court';
import { Player } from './types';

export default defineComponent({
	props: {
        player: {
            type: Object as () => Player,
            required: true,
        },
    },
	components: { },
	setup(props, { emit }) {
		const courtStore = useCourtStore();
        const attending = ref(getAttendanceFromServer());

        watch(() => [courtStore.sessionPlayers], () => {
            getAttendanceFromServer();
        });

		return {
            courtStore,
            attending,
            toggle,
		};

        function getAttendanceFromServer() {
            const sessionPlayer = courtStore.sessionPlayers.find((sessionPlayer: any) => sessionPlayer.player_id === props.player.id);
            return sessionPlayer ? sessionPlayer.attended : false;
        }

        function toggle(id: string, checked: boolean) {
            if (attending.value === checked) {
                return;
            }
            // console.log(`Toggled ${id} to ${checked}`)
            attending.value = checked;
            emit('attending', checked);
        }
	},
    watch: { }
});
</script>
