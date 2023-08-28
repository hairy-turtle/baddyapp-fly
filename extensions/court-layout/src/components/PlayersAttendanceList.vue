<template>
    <div>
        <SearchInput v-model="playerSearch" collection="ht_directory" />
        <div class="players-list">
            <div v-for="letter in playersGrouped.keys()" :key="letter">
                <v-list multiple v-if="playersGrouped.get(letter).length > 0">
                    <v-item-group>
                        <v-item>{{ letter }}</v-item>
                    </v-item-group>
                    <AttendanceSelector
                        v-for="player in playersGrouped.get(letter)"
                        v-bind:key="player.id"
                        ref="attendanceSelector"
                        :player="player"
                        @attending="toggle(player.id, $event)"/>
                </v-list>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue';
import { useCourtStore } from '../store/court';
import { Player } from './types';
import SearchInput from './SearchInput.vue'
import AttendanceSelector from './AttendanceSelector.vue'

let saveAttendanceTimer: any;

// We first create an array alphabet as a string of characters from 'a' to 'z' and use const assertion which makes TypeScript treat it as an array of literal types.
// Then, we use the typeof keyword in conjunction with the keyof operator to create a new type Alphabet which is the type of the element of the alphabet array.
// Now, we use the Alphabet type as the key type of the Map object nameGroups. Now, you can only use values of the type Alphabet as keys for the map.
const alphabet = 'abcdefghijklmnopqrstuvwxyz' as const;
type Alphabet = typeof alphabet[number];
interface AttendanceGroupedMap extends Map<Alphabet, Array<Player>>{}

export default defineComponent({
	props: { },
	components: { SearchInput, AttendanceSelector },
	setup(_props) {
		const courtStore = useCourtStore();
        const playerSearch = ref<string>('');
		
        // Create a static map of players grouped by first letter of first name
        // TODO: We should perform search on this list, not the playersDirectory
        // to avoid hitting the database on every character input.
        const playersGrouped = getAttendanceList();

        // States to manage selections. Allow deselect all, and undo if unintended.
        const updatedPlayers = ref(Array());

        watch(() => courtStore.selectedSessionId, () => {
            sessionUpdated();
        });

		return {
            courtStore,
            playersGrouped,
			toggle,
            sessionUpdated,
            playerSearch,
		};

        function getAttendanceList() {
            const lettersAToZ = computed(() => (Array.from({ length: 27 }, (_, i) => String.fromCharCode(64 + i))));
            const playersGrouped = ref<AttendanceGroupedMap>(new Map<Alphabet, Array<Player>>());
            watch(() => [courtStore.playersDirectory, playerSearch.value], reloadAttendanceList, { immediate: true });
            return playersGrouped;

            function reloadAttendanceList() {
                lettersAToZ.value.forEach(letter => {
                    const players = Array<Player>();
                    // Filter the playersDirectory by first letter of first name
                    const playersDirectoryFiltered = courtStore.playersDirectory.filter(player => player.first_name && player.first_name.startsWith(letter));
                    playersDirectoryFiltered.forEach((player) => {
                        // Check if player is in sessionPlayers
                        const sessionPlayer = courtStore.sessionPlayers.find((sessionPlayer: any) => sessionPlayer.player_id === player.id);
                        players.push({
                            id: player.id,
                            first_name: player.first_name,
                            last_name: player.last_name,
                            full_name: `${player.first_name} ${player.last_name}`,
                            level: Number(player.level),
                            pause: sessionPlayer ? sessionPlayer.paused : false,
                            member: courtStore.isPlayerACurrentMember(player),
                            last_active: player.date_updated ? new Date(player.date_updated) : new Date(player.date_created),
                        });
                    });

                    playersGrouped.value.set(letter, players.sort((a, b) => (a.first_name > b.first_name) ? 1 : -1));
                });

                // Only return the list of shortlisted players if there is a search term
                if (playerSearch.value !== '') {
                    for (const [_key, value] of playersGrouped.value) {
                        const matched = value.filter(player => player.full_name.toLowerCase().includes(playerSearch.value.toLowerCase()));
                        playersGrouped.value.set(_key, matched);
                    }
                }

                return playersGrouped;
            }
        }

        function toggle(id: string, attending: boolean) {
            console.log(`Toggled ${id} to ${attending}`)
            
            // If found in updatedPlayers, update it, if not, push to updatedPlayers.
            const playerToUpdate = updatedPlayers.value.find((player: any) => player.id === id);
            if (playerToUpdate) {
                playerToUpdate.attending = attending;
            }
            else {
                updatedPlayers.value.push({
                    id: id,
                    attending: attending,
                });
            }
            
            // Set timer to save attendance to database in case more changes happen in the mean time
            // (e.g. user selects another player).
            if (saveAttendanceTimer) {   
                clearTimeout(saveAttendanceTimer);
            }
            saveAttendanceTimer = setTimeout(() => {
                courtStore.commitSessionPlayersChanges(updatedPlayers.value);
                updatedPlayers.value = [];
            }, 1000);
        }

        function sessionUpdated(newSessionId?: string, _oldSessionId?: string) {
            if (newSessionId) {
                // Sync the new session's attendance to it.
                courtStore.refreshSessionPlayers();
            }
        }
	},
    watch: { }
});
</script>

<style lang="scss" scoped>
.players-list {
	overflow-y: scroll;

	position: relative;
	// 60px = header height
	// 45px = session selector
	// 38px = left panel tabs
	max-height: calc(95vh - 60px - 45px - 38px);

    .attendance-section {
        margin-top: 2rem;
        margin-bottom: 1rem;
    }

    .attendance-player {
        margin-bottom: 0.5rem;
    }
}
</style>