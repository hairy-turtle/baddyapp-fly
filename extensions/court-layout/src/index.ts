import { ref } from 'vue';
import { defineLayout } from '@directus/extensions-sdk';
import LayoutComponent from './CourtsLayout.vue';

export default defineLayout({
	id: 'court',
	name: 'Court',
	icon: 'grid_view',
	component: LayoutComponent,
	smallHeader: true,
	slots: {
		options: () => null,
		sidebar: () => null,
		actions: () => null,
	},
	setup() {
		const name = ref('Courts Layout');

		return { name };
	},
});
