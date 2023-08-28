<template>
	<div>
        <v-icon
            v-if="!isSelectMode"
            :class="getIconStatus(player)"
            :name="getIcon(player)"
            @click="onIconClicked(player)"/>
        <v-checkbox
            v-else
            v-model="isSelected"
            :disabled="disabled || playerIsMandatory || !selectable"
            :icon-on="getCheckboxOnIcon(player)"
            :icon-off="getCheckboxOffIcon(player)"
            :icon-indeterminate="getCheckboxOffIcon(player)"
            @update:modelValue="$emit('on-checkbox-changed', player, $event)"
            />
    </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, toRefs, watch } from 'vue';
import { Player } from './types';
import { useCourtStore } from '../store/court';

export default defineComponent({
	props: {
        player: {
            type: Object as () => Player,
            required: true,
        },
        selected: {
            type: Boolean,
            required: false,
            default: false,
        },
        mandatoryPlayers: {
            type: Array as () => Player[],
            required: true,
        },
        isSelectMode: {
            type: Boolean,
            required: false,
        },
        disabled: {
            type: Boolean,
            required: false,
            default: false,
        },
		selectable: {
			type: Boolean,
			required: false,
			default: false,
		},
		swapMode: {
			type: Boolean,
			required: false,
			default: false,
		},
    },
	components: { },
    emits: ['on-pause-changed', 'on-checkbox-changed'],
	setup(props, { emit }) {
        const { player, isSelectMode, disabled, selected, mandatoryPlayers, swapMode } = toRefs(props);
		const courtStore = useCourtStore();
        const playerIsMandatory = computed(() => {
            return mandatoryPlayers.value.includes(player.value) && !swapMode.value;
        });
        const isSelected = ref<boolean>(false);
        
        watch(() => [
			selected.value,
			mandatoryPlayers.value,
			player.value.pause
		], () => {
            isSelected.value = (playerIsMandatory.value || selected.value) && !player.value.pause;
        }, { immediate: true });
		
		return {
            player, isSelectMode, disabled,
			courtStore,
			getIconStatus,
			getIcon,
			getCheckboxOnIcon,
			getCheckboxOffIcon,
            onIconClicked,
			isSelected,
            playerIsMandatory,
		};

		function getIconStatus(player: Player) {
			return player.pause ? 'unpause-player' : 'pause-player';
		}

		function getIcon(player: Player) {
            return player.pause ? 'bedtime_off' : 'bedtime';
		}

		function getCheckboxOnIcon(player: Player) {
			return player.pause ? 'bedtime_off' : 'check_box';
		}

		function getCheckboxOffIcon(player: Player) {
			return player.pause ? 'bedtime_off' : (!props.selectable ? 'indeterminate_check_box' : 'check_box_outline_blank');
		}

        function onIconClicked(player: Player) {
            // Pause / unpause player
            courtStore.togglePlayerPaused(player);
            emit('on-pause-changed', player);
        }
	},
});
</script>

<style lang="scss" scoped>
.waitlist-table {
	overflow-y: auto;
	overscroll-behavior: contain;
	/** Disable horizontal scroll, clamp to 100% width */
	width: 100%;
	overflow-x: hidden;

	.pause-player {
		color: var(--module-icon);
	}
	.pause-player-disabled {
		color: var(--module-icon);
		cursor: not-allowed;
	}

	.pause-player:hover {
		color: var(--module-icon-alt);
	}
	.pause-player-disabled:hover {
		color: var(--module-icon);
		cursor: not-allowed;
	}

	.unpause-player {
		color: var(--danger-50);
	}
	.unpause-player-disabled {
		color: var(--danger-50);
		cursor: not-allowed;
	}

	.unpause-player:hover {
		color: var(--danger-75);
	}
	.unpause-player-disabled:hover {
		color: var(--danger-50);
		cursor: not-allowed;
	}
}



</style>