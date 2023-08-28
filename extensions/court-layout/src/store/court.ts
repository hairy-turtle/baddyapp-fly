import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { useRoute } from 'vue-router';
import { useApi, useItems } from '@directus/extensions-sdk';
import { AppRefreshItem, CourtDetails, CourtState, Player } from '../components/types';
import { MAX_COURTS, MAX_PLAYER, INTERVAL_APP_REFRESH_MS } from '../components/types';
import emitter, { Events } from './events';

interface WaitListPlayer extends Player {
    queued_at: Date | null; 
}

export const useCourtStore = defineStore('courtStore', () => {
    let checkActiveCourtTimer: any;
    let recalculateWaitListTimer: any;
    let eventRefresh: any;
    const api = useApi();

    const selectedSessionId = ref<string | null>(null);
    const activeCourts = ref<Array<number>>([]);

    const { items: courtEvents, getItems: refreshCourtEvents } = useItems(
        ref('ht_events'),
        {
            sort: computed(() => ['-date_created']),
            page: ref(1),
            limit: ref(6000), // cannot limit here because there may be many historical events for one particular court and none for others!
            fields: computed(() => ['id', 'date_created', 'date_updated', 'player_id', 'court', 'session', 'is_captain']),
            filter: computed(() => {
                if (selectedSessionId.value === null) return null;
                return {
                    session: {
                        _eq: selectedSessionId.value,
                    },
                    // Not filtering for date_updated because we want all previously played events
                    // to keep track of the player's history / last played time and court.
                };
            }),
            search: ref(),
        },
        true
    );

    const { items : playersDirectory, itemCount: directoryItemCount, getItems: refreshPlayerDirectory } = useItems(
        ref('ht_directory'),
        {
            sort: computed(() => null),
            page: ref(1),
            limit: ref(5000),
            fields: computed(() => ['id', 'first_name', 'last_name', 'level', 'membership_expiry']),
            filter: computed(() => null),
            search: ref(),
        },
        false
    );

    const { items : sessionPlayers, getItems : refreshSessionPlayers } = useItems(
        ref('ht_session_players'),
        {
            sort: computed(() => null),
            page: ref(1),
            limit: computed(() => selectedSessionId.value === null ? 0 : 8888),
            fields: computed(() => ['id', 'session_id', 'player_id', 'attended', 'paused', 'queued_at', 'date_created', 'date_updated']),
            filter: computed(() => {
                if (selectedSessionId.value === null) return null;
                return {
                    session_id: {
                        _eq: selectedSessionId.value,
                    },
                };
            }),
            search: ref(),
        },
        true
    );

    const { courtStates, loadCourtEventsFromServer } = getInitialCourtStates();
    const { waitList, queuedPlayersGroups } = getWaitList();
    
    const courtInSelectMode = computed<number | null>(() => {
        // For each key-value pair, find the first one that is in the SelectingPlayers state.
		const courtState = Object.entries(courtStates.value).find(([, courtDetails]) => courtDetails.state === CourtState.SelectingPlayers);
		return courtState ? Number(courtState[0]) : null;
    });

    const currentRoute = useRoute();
    const playerToSwapCourtNumber = ref<number | null>(null);
    const playerToSwapOut = ref<Player | null>(null);
    const playerToSwapIn = ref<Player | null>(null);
    const appRefreshItems = ref<Set<AppRefreshItem>>(new Set([AppRefreshItem.Courts, AppRefreshItem.Players, AppRefreshItem.Directory]));

    watch(
        () => currentRoute.params,
        (routeName) => {
            // When switching to the ht_events collection, refresh the available sessions
            if (routeName.collection === 'ht_events') {
                console.log('Refreshing layout');
                reloadLayout();
            }
        },
        { immediate: true }
    );

    watch(() => [selectedSessionId.value], onSelectedSessionId, { immediate: true });

    // Watch all state value in the courtStates array, and if any court state is in transition state, pause the app refresh.
    // This is to avoid the app refresh from overwriting the changes while a user is making changes to the courts.
    watch(() => Object.values(courtStates.value), () => {
        const courtInTransitionState = Object.values(courtStates.value).find((courtDetails) => 
            courtDetails.state === CourtState.SelectingPlayers
            || courtDetails.state === CourtState.ConfirmComplete);

        if (courtInTransitionState) {
            pauseAppRefreshItem(AppRefreshItem.Courts);
        }
        else {
            resumeAppRefreshItem(AppRefreshItem.Courts);
        }
    }, { deep: true });

    // Kickoff the intervals to refresh the data for multi-device support
    resumeAppRefresh();

    return {
        // Exported ht_directory objects for logics in components
        playersDirectory,
        directoryItemCount,
        // Exported ht_session_players objects for logics in components
        sessionPlayers,
        refreshSessionPlayers,
        commitSessionPlayersChanges,
        commitQueuedSessionPlayers,
        // Exported ht_events objects for logics in components
        courtEvents,
        addPlayersToCourt,
        removePlayersFromCourt,
        markHistoricalEventsAsUpdated,
        // Other calculated values
        selectedSessionId,
        courtStates,
        courtInSelectMode,
        activeCourts,
        waitList,
        queuedPlayersGroups,
        togglePlayerPaused,
        reloadLayout,
        isPlayerACurrentMember,
        // Swap feature, shared across WaitList and Court
        playerToSwapOut,
        playerToSwapIn,
        playerToSwapCourtNumber,
        confirmSwapPlayers,
        // Items supporting interval refreshes for multi-device support
        pauseAppRefreshItem,
        resumeAppRefreshItem,
    }

    function reloadLayout() {
        refreshCourtEvents();
        refreshSessionPlayers();
        refreshPlayerDirectory();
        onSelectedSessionId();
    }

    function pauseAppRefresh() {
        if (eventRefresh) {
            clearInterval(eventRefresh);
        }
    }

    function resumeAppRefresh() {
        clearInterval(eventRefresh);

        // Set timeout every 5 seconds to refresh courtEvents, sessionPlayers, and playerDirectory
        // This is to ensure that the data is always up to date
        eventRefresh = setInterval(() => {
            // console.log('Refreshing app data for: ', appRefreshItems.value)
            if (appRefreshItems.value.has(AppRefreshItem.Courts)) {
                refreshCourtEvents();
            }

            if (appRefreshItems.value.has(AppRefreshItem.Players)) {
                refreshSessionPlayers();
            }

            if (appRefreshItems.value.has(AppRefreshItem.Directory)) {
                refreshPlayerDirectory();
            }
        }, INTERVAL_APP_REFRESH_MS);
    }

    function pauseAppRefreshItem(item: AppRefreshItem) {
        appRefreshItems.value.delete(item);
    }

    function resumeAppRefreshItem(item: AppRefreshItem) {
        appRefreshItems.value.add(item);
    }

    async function onSelectedSessionId() {
        if (!selectedSessionId.value) return;
        if (!courtStates.value) return;

        try {
            console.log('Fetching session data for session: ', selectedSessionId.value);

            // Get the session data
            const sessionResponse = await api.get(`/items/ht_session/${selectedSessionId.value}`, {
                params: {
                    fields: ['id', 'session_date', 'start_datetime', 'end_datetime', 'court_allocation'],
                },
            });

            const sessionData = sessionResponse.data.data;

            // Now get all related ht_session_court items for this session from ht_session_court_allocation
            const junctionResponse = await api.get(`/items/ht_session_court_allocation`, {
                params: {
                    filter: {
                        ht_session_id: {
                            _eq: selectedSessionId.value,
                        },
                    },
                    fields: ['id', 'ht_session_id', 'item', 'collection'],
                },
            });
            const rawJunctionData = junctionResponse.data.data;

            // Reset all courtStates's active before updating
            for (const courtState of Object.values(courtStates.value)) {
                courtState.active = false;
            }

            // Lastly, get all court allocation data for each ht_session_court item
            for (const junction of rawJunctionData) {
                const sessionCourtResponse = await api.get(`/items/ht_session_courts/${junction.item}`, {
                    params: {
                        fields: ['id', 'start_time', 'end_time', 'active_courts'],
                    },
                });
                
                const sessionCourtData = sessionCourtResponse.data.data;
                // start_time and end_time are in the format of "09:00:00", we need to convert to Date using session_date
                const sessionDate = new Date(sessionData.session_date);
                const startTime = convertTimeStringToDate(sessionCourtData.start_time, sessionDate);
                const endTime = convertTimeStringToDate(sessionCourtData.end_time, sessionDate);

                // Parse literal array string into array
                const courtsArray = sessionCourtData.active_courts;
                // Loop through sessionCourtData.active_courts and assign to courtStates
                for (const court of courtsArray) {
                    const courtNumber = parseInt(court);
                    // Ensure courtNumber is between 1 and MAX_COURTS
                    if (courtNumber < 1 || courtNumber > MAX_COURTS) {
                        throw new Error(`Invalid court number: ${courtNumber}`);
                    }

                    // Update courtStates.value[courtNumber]'s active, start_time, and end_time
                    // Check if courtStates.value[courtNumber] exists first
                    const item = courtStates.value[courtNumber];
                    if (item !== undefined) {
                        item.active = true;
                        item.start_time = startTime;
                        item.end_time = endTime;
                    } else {
                        // This shouldn't happen ideally, since we should have initialised all courts
                        // If this happens, we should initialise the court
                        courtStates.value[courtNumber] = {
                            number: courtNumber,
                            state: CourtState.Inactive,
                            players: [],
                            active: true,
                            start_time: startTime,
                            end_time: endTime,
                        };
                    }
                }

                // For each court details, print the court allocation and active courts
                for (const [courtNumber, courtDetails] of Object.entries(courtStates.value)) {
                    console.log(`Court ${courtNumber}: ${courtDetails.active ? 'Active' : 'Inactive'} ${courtDetails.start_time.toLocaleTimeString()} - ${courtDetails.end_time.toLocaleTimeString()}`);
                }
            }
        } catch (error) {
            console.error(error);
        }

        recalculateActiveCourts();
        loadCourtEventsFromServer();
    }

    function getPlaceholderEmptyPlayer() {
        return {
            // Since vue tables expects IDs that are unique, we randomize the empty player IDs.
            id: Math.random().toString(36).substring(7),
            first_name: '',
            last_name: '',
            full_name: '',
            level: 0,
            pause: false,
            member: false,
            captain: false,
            last_active: new Date(),
        }
    }

    function getInitialCourtStates() {
        const courtStates = ref<{[key: number]: CourtDetails}>({});

        watch(() => [courtEvents.value], loadCourtEventsFromServer, { immediate: true });

        return { courtStates, loadCourtEventsFromServer };

        function loadCourtEventsFromServer() {
            console.log('Loading court players from server');
            for (let i = 1; i <= MAX_COURTS; i++) {
                const item = courtStates.value[i];
                if (item !== undefined) {
                    item.players = getPlayersForCourt(i);
                }
                else {
                    // This shouldn't happen ideally, since we should have initialised all courts
                    // If this happens, we should initialise the court
                    courtStates.value[i] = {
                        number: i,
                        state: CourtState.Inactive,
                        players: getPlayersForCourt(i),
                        active: false,
                        start_time: new Date(),
                        end_time: new Date(),
                    }
                }
            }
        }

        function getPlayersForCourt(courtNumber: number) {
            // Get the players for this court. Take extra care to ensure that the court number comparison is of the same type!
            const courtEventsForCourt = courtEvents.value.filter((ht_event) =>
                ht_event.court === courtNumber.toString()
                && ht_event.date_updated === null);

            // If court is not active or there's no game, return empty players
            if (courtEventsForCourt.length === 0 ||
                !activeCourts.value.includes(courtNumber)) {
                const playersForCourt = [];
                for (let i = 0; i < MAX_PLAYER; i++) {
                    playersForCourt.push(getPlaceholderEmptyPlayer());
                }
                return playersForCourt;
            }

            if (courtEventsForCourt.length > MAX_PLAYER) {
                // Safeguard by marking all players as completed for the court
                removePlayersFromCourt(courtNumber);
                throw new Error(`Court ${courtNumber} has more than ${MAX_PLAYER} players`);
            }
            
			const playersForCourt = courtEventsForCourt.map((ht_event) => {
				const player = playersDirectory.value.find((player) => player.id === ht_event.player_id);
				if (player) {
					return {
						id: player.id,
						first_name: player.first_name,
						last_name: player.last_name,
						full_name: `${player.first_name} ${player.last_name}`,
						level: Number(player.level),
                        pause: false,
                        member: isPlayerACurrentMember(player),
                        last_active: getPlayerLastPlayedTime(player.id),
					};
				}
				else {
					return {
						id: ht_event.player_id,
						first_name: 'Unknown',
						last_name: 'Player',
						full_name: 'Unknown Player',
						level: 5,
                        pause: true,
                        member: false,
                        last_active: getPlayerLastPlayedTime(ht_event.player_id),
					};
				}
			});

            // Pad playersForCourt with empty players if there are less than MAX_PLAYER
            // TODO: We force the court to always have 4 rows to make CSS a bit easier.
            // This is a bit of a hack, but it works for now.
            for (let i = playersForCourt.length; i < MAX_PLAYER; i++) {
                playersForCourt.push(getPlaceholderEmptyPlayer());
            }

            // Since we're reading from the server, we may have lost the sequence of the players.
            // Here, we sort the players by making sure captain is first in the list, then
            // all other players follows by getting the last played time.
            playersForCourt.sort((a, b) => {
                if (a.last_active === undefined && b.last_active === undefined) {
                    return 0;
                } else if (a.last_active === undefined) {
                    return 1;
                } else if (b.last_active === undefined) {
                    return -1;
                } else {
                    return a.last_active.getTime() - b.last_active.getTime();
                }
            });

            return playersForCourt;
		};
    }

    // Converts time in format of "09:00:00" to Date with the at_date argument
    function convertTimeStringToDate(at_time: string, at_date: Date) {
        // Confirm that at_time is in the format of "09:00:00"
        if (!at_time.match(/^\d{2}:\d{2}:\d{2}$/)) {
            throw new Error(`Invalid time string: ${at_time}`);
        }

        // Split at_time into hours, minutes, seconds
        const [hours, minutes, seconds] = at_time.split(':').map((s) => parseInt(s));
        
        // Return new date object with at_date date and at_time time
        return new Date(
            at_date.getFullYear(),
            at_date.getMonth(),
            at_date.getDate(), 
            hours,
            minutes,
            seconds
        );
    }

    function recalculateActiveCourts() {
        // console.log('recalculateActiveCourts')

        // Get a copy of activeCourts to compare with the new activeCourts
        const oldActiveCourts = [...activeCourts.value];
        activeCourts.value = [];

        const now = new Date();
        // Insert court number to activeCourts if courtStates.value[courtNumber].active
        // is true and courtStates.value[courtNumber].end_time is after now
        for (const [courtNumber, courtDetails] of Object.entries(courtStates.value)) {
            if (courtDetails.active && courtDetails.end_time > now) {
                activeCourts.value.push(parseInt(courtNumber));
            }
        }
        console.log('activeCourts: ', activeCourts.value);

        // If courts were active but is now inactive, remove players from the court
        const courtsBecameInactive = oldActiveCourts.filter((courtNumber) => !activeCourts.value.includes(courtNumber));
        for (const courtNumber of courtsBecameInactive) {
            removePlayersFromCourt(courtNumber);
        }   

        // Set timeout to refresh activeCourts in the next whole minute
        const nextMinute = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1, 0);
        const timeout = nextMinute.getTime() - now.getTime();

        if (checkActiveCourtTimer) {   
            clearTimeout(checkActiveCourtTimer);
        }

        checkActiveCourtTimer = setTimeout(() => {
            recalculateActiveCourts();
        }, timeout);
    }

    async function togglePlayerPaused(player: Player) {
        player.pause = !player.pause;

        // Get the player id and set it to the sessionPlayer table
        const sessionPlayerRaw = await api.get('/items/ht_session_players/', {
            params: {
                fields: ['id', 'session_id', 'player_id', 'attended', 'paused'],
                limit: 1,
                filter: {
                    session_id: {
                        _eq: selectedSessionId.value,
                    },
                    player_id: {
                        _eq: player.id,
                    },
                }
            },
        });

        const sessionPlayer = sessionPlayerRaw.data.data;
        if (sessionPlayer.length > 0) {
            const sessionPlayerId = sessionPlayer[0].id;
            await api.patch(`/items/ht_session_players/${sessionPlayerId}`, {
                paused: player.pause,
            });
        }

        await refreshSessionPlayers();

        emitter.emit(Events.player_pause_state_changed);
    }

    async function addPlayersToCourt(courtNumber: number, selectedPlayers: Player[]) {
        commitQueuedSessionPlayers(selectedPlayers, /*isQueueing = */ false);

        // Ensure the current courtEvents don't have selectedPlayers with date_updated that is null
        // which means they are already placed on the court. This ensures idempotency, allowing this
        // function to be called multiple times without issues, short-circuited as earlier as possible.
        const playingPlayers = courtEvents.value.filter((ht_event) => 
                ht_event.court === courtNumber.toString()
                && ht_event.date_updated === null);
        
        // Console log the playing players for this court
        if (playingPlayers.length > 0) {
            console.log(`Players already playing on court ${courtNumber}:`);
            for (const playingPlayer of playingPlayers) {
                console.log(`Player ${playingPlayer.player_id} is found on court ${courtNumber}.`);
            }
            return;
        }
        else {
            console.log(`No players found on court ${courtNumber}, ok to proceed.`)
        }

        // For each players selected to this court, create an event
        // Form an array of params for batch patching
        const paramsArrayPost = selectedPlayers.map((player) => {
            // Player is captain if he is the first index in the list
            // TODO: What if we use last_active instead of first indexed player?
            const isCaptain = selectedPlayers.indexOf(player) === 0;
            return {
                // For each player added, add a bit of delay to the date_created.
                // This is to prevent the same date_created for multiple events, making them sortable.
                date_created: new Date(new Date().getTime() + selectedPlayers.indexOf(player) * 100),
                session: selectedSessionId.value,
                court: courtInSelectMode.value ? courtInSelectMode.value : courtNumber,
                player_id: player.id,
                is_captain: isCaptain,
            }
        });

        if (paramsArrayPost.length > 0) {
            console.log('addPlayersToCourt paramsArrayPost: ', paramsArrayPost);
            await api.post(`/items/ht_events`, paramsArrayPost);

            // We need to wait for courtEvents to fully refresh before we can return
            // because many states depend on the updated events, also ensures idempotency
            // since the courtEvents is the only place we can check if the players exist.
            await refreshCourtEvents();

            emitter.emit(Events.added_players_to_court, courtNumber);

            // Update courtStates.value[courtNumber].players
            const courtDetails = courtStates.value[courtNumber];
            if (courtDetails !== undefined) {
                courtDetails.players = selectedPlayers;
                // Remove these players from waitList immediately, even though courtEvents changes will kick off
                // recalculateWaitList(), this is because we want to avoid debounce delay when triggered by a user.
                for (const player of selectedPlayers) {
                    waitList.value = waitList.value.filter((waitListPlayer) => waitListPlayer.id !== player.id);
                }
            } else {
                // This shouldn't happen ideally, since we should have initialised all courts
                // If this happens, warn the user
                alert(`Court ${courtNumber} is not initialised!`);
            }
        }
    }

    async function removePlayersFromCourt(courtNumber: number) {
        const now = new Date();

        const courtDetails = courtStates.value[courtNumber];
        if (courtDetails !== undefined && courtDetails.players.length > 0) {            
            // Conscious decision that when we remove players from court, we will
            // remove all players from the court, including ones from the past.
            const courtEventsForCourt = courtEvents.value.filter((ht_event) => 
                ht_event.court === courtNumber.toString()
                && ht_event.date_updated === null);

            const paramsArrayPatch = courtEventsForCourt
                .map((ht_event) => {
                    return {
                        id: ht_event.id,
                        court: courtNumber,
                        session: selectedSessionId.value,
                        player_id: ht_event.player_id,
                        date_updated: now.toISOString(),
                    }
                });

            // Only post if there are players to update
            if (paramsArrayPatch.length > 0) {
                await api.patch(`/items/ht_events`, paramsArrayPatch);
                for (let i = 0; i < MAX_PLAYER; i++) {
                    // Replace each courtDetails.players with empty player
                    courtDetails.players[i] = getPlaceholderEmptyPlayer();
                }

                // We need to wait for courtEvents to fully refresh before we can return
                // because many states depend on the updated events, also ensures idempotency
                // since the courtEvents is the only place we can check if the players exist.
                await refreshCourtEvents();
    
                emitter.emit(Events.removed_players_from_court, courtNumber);
            }
        }
    }

    async function markHistoricalEventsAsUpdated(previousSessionEndDatetime: Date) {
        // Temporarily not using this function as a refresh of a page, or logging in
        // on a separate device is causing all courts to be cleared for some reason.
        return;
        const now = new Date();

        // Find all events that are not updated
        const eventsResponse = await api.get('/items/ht_events/', {
            params: {
                fields: ['id', 'date_created', 'date_updated'],
                filter: {
                    date_created: {
                        _lt: previousSessionEndDatetime,
                    },
                    date_updated: {
                        _null: true,
                    },
                }
            },
        });

        // For all events that are not updated, update them with the current time
        const events = eventsResponse.data.data;
        const paramsArrayPatch = events.map((event: any) => {
            return {
                id: event.id,
                date_updated: now.toISOString(),
            }
        });

        if (paramsArrayPatch.length > 0) {
            await api.patch(`/items/ht_events`, paramsArrayPatch);
        }
    }

    function getWaitList() {
        // Note: WaitList contains all attending players that are not in a court (including queued players)
        const waitList = ref<Array<WaitListPlayer>>([]);
        const queuedPlayersGroups = ref<Array<Array<Player>>>([]);
        const waitListReloading = ref(false);

        emitter.on(Events.player_attendance_changed, recalculateWaitList);

        watch(() => [
            selectedSessionId.value,
            courtStates.value,
            courtEvents.value,
            sessionPlayers.value,
            playersDirectory.value,
        ], recalculateWaitList, { immediate: true });

        return { waitList, queuedPlayersGroups, recalculateWaitList };

        function recalculateWaitList() {
            // Debounce as we are listening to many events
            if (waitListReloading.value) return;
            waitListReloading.value = true;

            if (recalculateWaitListTimer) {
                clearTimeout(recalculateWaitListTimer);
            }
            
            recalculateWaitListTimer = setTimeout(() => {
                waitListReloading.value = false;
                calculateWaitList();
            }, 100);
        }

        async function calculateWaitList() {
            if (playersDirectory.value.length === 0) return;

            // console.log('recalculateWaitList');
            
            // Get player_id where date_updated is null (still playing)
            const playingPlayers = courtEvents.value.filter((player: any) => player.date_updated === null);

            waitList.value = [];
            for (const sessionPlayer of sessionPlayers.value) {
                const player = playersDirectory.value.find((player) => player.id === sessionPlayer.player_id);
                const isAttending = sessionPlayer.attended;
                // Player is playing if player.id is in playingPlayers
                const isPlaying = playingPlayers.find((player: any) => player.player_id === sessionPlayer.player_id);
                // Also make sure there's no duplicate, since we cannot guarantee uniqueness across multiple columns (no surrogate key)
                const isDuplicate = waitList.value.find((player: any) => player.id === sessionPlayer.player_id);
                if (player && isAttending && !isPlaying && !isDuplicate) {
                    waitList.value.push({
                        id: player.id,
                        first_name: player.first_name,
                        last_name: player.last_name,
                        full_name: `${player.first_name} ${player.last_name}`,
                        level: Number(player.level),
                        pause: sessionPlayer.paused,
                        member: isPlayerACurrentMember(player),
                        last_active: getPlayerLastPlayedTime(sessionPlayer.player_id),
                        queued_at: sessionPlayer.queued_at ? new Date(sessionPlayer.queued_at) : null,
                    });
                }
            }

            waitListReloading.value = false;

            calculateQueuedPlayers();
        }

		function calculateQueuedPlayers() {
			let _queuedPlayersGroups = [];

			// Get players from courtStore.sessionPlayers with non-null queued_at value
			const playersAlreadyQueued = waitList.value.filter(p => p.queued_at !== null);

			// Sort queuedSessionPlayers by queued_at ascending. Use getTime() to sort.
			playersAlreadyQueued.sort((a, b) => a.queued_at!.getTime() - b.queued_at!.getTime());
			
			// Group players by queued_at, which should be size of MAX_PLAYER
			for (let i = 0; i < playersAlreadyQueued.length; i += MAX_PLAYER) {
				const sessionPlayersGrouped = playersAlreadyQueued.slice(i, i + MAX_PLAYER);
				// Convert playersGrouped to Players by forming array from waitList that matches the id
				const players = sessionPlayersGrouped.map(queuedPlayer => waitList.value.find(p2 => p2.id === queuedPlayer.id)!);
				if (players.length === MAX_PLAYER) {
                    _queuedPlayersGroups.push(players);
                }
			}

            // For each group in _queuedPlayersGroups, check if the group is changed compared to queuedPlayersGroups
            // If it is changed, then we need to update the queuedPlayersGroups
            let isChanged = false;
            if (_queuedPlayersGroups.length !== queuedPlayersGroups.value.length) {
                isChanged = true;
            }
            else {
                for (let i = 0; i < _queuedPlayersGroups.length; i++) {
                    const group1 = _queuedPlayersGroups[i];
                    const group2 = queuedPlayersGroups.value[i];
                    if (!group1 || !group2) {
                        // Before reference objects were created, only run later when defined
                        return;
                    }

                    if (group1.length !== group2.length) {
                        isChanged = true;
                        break;
                    }

                    for (let j = 0; j < group1.length; j++) {
                        if (group1[j]!.id !== group2[j]!.id) {
                            isChanged = true;
                            break;
                        }
                    }
                }
            }

            if (isChanged) {
                queuedPlayersGroups.value = _queuedPlayersGroups;
                // console log the length of _queuedPlayersGroups
                console.log('queuedPlayersGroups', _queuedPlayersGroups.length);
            }
		}
    }

    function isPlayerACurrentMember(player: typeof playersDirectory.value[0]) {
        if (player.membership_expiry) {
            const membershipExpiryDate = new Date(player.membership_expiry);
            const currentDate = new Date();
            return membershipExpiryDate > currentDate;
        }
        return false;
    }

    function getPlayerLastPlayedTime(player_id: string) {
        // Get last played time from ht_events if found
        const lastPlayedTimes = courtEvents.value.filter((ht_event) =>
            ht_event.player_id === player_id
            && ht_event.date_updated !== null);

        // If there are one or more last played timestamps, then we take the latest one
        let lastPlayedTime = null;
        if (lastPlayedTimes.length > 0) {
            lastPlayedTime = lastPlayedTimes.reduce((prev, current) => (prev.date_updated > current.date_updated) ? prev : current).date_updated;
        }
        else {
            // Otherwise, we take the attendance time
            const sessionPlayer = sessionPlayers.value.find((sessionPlayer) => sessionPlayer.player_id === player_id);
            if (sessionPlayer) {
                // Attendance time is the last updated time if it exists (pause/unpaused updates), otherwise it is the created time
                lastPlayedTime = sessionPlayer.date_updated ?? sessionPlayer.date_created;
            }
        }

        return new Date(lastPlayedTime);
    }

    async function commitSessionPlayersChanges(updatedPlayers: { id: string, attending: boolean }[]) {
        if (selectedSessionId.value === null) return;

        // Find all players that exist in the session_players table by checking if updatedPlayers.id is in sessionPlayers.value
        const playersToPatch = sessionPlayers.value.filter((sessionPlayer) => updatedPlayers.find(updatedPlayer => updatedPlayer.id === sessionPlayer.player_id));

        if (playersToPatch.length > 0) {
            // Form params for batch patching
            const paramsArrayPatch = playersToPatch.map(sessionPlayers => {
                const isPlayerAttending = updatedPlayers.find(updatedPlayer => updatedPlayer.id === sessionPlayers.player_id)?.attending ?? false;
                return {
                    id: sessionPlayers.id,
                    player_id: sessionPlayers.player_id,
                    session_id: selectedSessionId.value,
                    attended: isPlayerAttending,
                    paused: false,
                }
            });
            // console.log('Changing players attendance, patching param: ', paramsArrayPatch)
            await api.patch(`/items/ht_session_players`, paramsArrayPatch);
        }
        
        // Get the remaining players to post as new records.
        const playersToPatchIds = playersToPatch.map(player => player.player_id);
        const newAttendingPlayers = updatedPlayers.filter(player => !playersToPatchIds.includes(player.id));
        if (newAttendingPlayers.length > 0) {
            // Form an array of params for batch patching
            const paramsArrayPost = newAttendingPlayers.map((player: { id: string; attending: boolean; }) => {
                const isPlayerAttending = player.attending;
                return {
                    session_id: selectedSessionId.value,
                    player_id: player.id,
                    attended: isPlayerAttending,
                    paused: false,
                }
            });
            // console.log('Adding players to attendance, posting: ', paramsArrayPost)
            await api.post(`/items/ht_session_players`, paramsArrayPost);
        }

        await refreshSessionPlayers();

        emitter.emit(Events.player_attendance_changed);
    }

    // Use this function to add players as queued or remove from queue (isQueueing = false)
    async function commitQueuedSessionPlayers(queuedPlayers: Player[], isQueueing: boolean = true) {
        const now = new Date();

        if (isQueueing) {
		    queuedPlayersGroups.value.push(queuedPlayers);
        } else {
            // Remove the first group of queued players that matches the queuedPlayers
            const index = queuedPlayersGroups.value.findIndex(group => group.every(p => queuedPlayers.find(p2 => p2.id === p.id)));
            if (index > -1) {
                queuedPlayersGroups.value.splice(index, 1);
            }
        }

        // Find all players that exist in the session_players table that matches queuedPlayers
        const playersToPatch = sessionPlayers.value.filter((sessionPlayer) => queuedPlayers.find(queuedPlayer => queuedPlayer.id === sessionPlayer.player_id) && sessionPlayer.attended);

        if (playersToPatch.length > 0) {
            // Must first sort playersToPatch by date_updated ascending,
            // so that the first player is the first to be queued.
            // If date_updated is null, then use date_created.
            playersToPatch.sort((a, b) => {
                const aTime = a.data_updated ?? a.date_created;
                const bTime = b.data_updated ?? b.date_created;
                const aDate = new Date(aTime);
                const bDate = new Date(bTime);
                return aDate.getTime() - bDate.getTime();
            });

            // Form params for batch patching
            const paramsArrayPatch = playersToPatch.map(sessionPlayers => {
                return {
                    id: sessionPlayers.id,
                    player_id: sessionPlayers.player_id,
                    session_id: selectedSessionId.value,
                    queued_at: isQueueing ? now.toISOString() : null,
                }
            });
            // console.log('Changing queued session players, patching param: ', paramsArrayPatch)
            await api.patch(`/items/ht_session_players`, paramsArrayPatch);
        }

        await refreshSessionPlayers();

        emitter.emit(Events.player_queue_state_changed);
    }

    async function confirmSwapPlayers() {
        if (playerToSwapCourtNumber.value === null) return;
        
        const courtNumber = playerToSwapCourtNumber.value;
        const courtState = courtStates.value[courtNumber];
        if (playerToSwapOut.value === null) return;
        if (playerToSwapIn.value === null) return;
        if (courtState === undefined) return;

        // Swap player in and out
        const courtPlayers = courtState.players;
        const playerToSwapOutIndex = courtPlayers.findIndex((player) => player.id === playerToSwapOut.value!.id);
        courtPlayers[playerToSwapOutIndex] = playerToSwapIn.value;

        // Get the id of the row in ht_event for the playerToSwapOut to patch
        const playerToSwapOutEventId = courtEvents.value.find((ht_event) => ht_event.player_id === playerToSwapOut.value!.id)?.id;
        await api.patch(`/items/ht_events/${playerToSwapOutEventId}`, {
            player_id: playerToSwapIn.value!.id,
            date_updated: null, // Must be null to be considered as "still playing"
        });

        // Reset values. Consider placing them into an object!
        playerToSwapOut.value = null;
        playerToSwapIn.value = null;
        playerToSwapCourtNumber.value = null;

        // Refresh court states so that waitlist is updated
        refreshCourtEvents();
    }
});