import { Routes } from '@angular/router';
import { authGuard } from './services/auth.guard';

export const routes: Routes = [
	{ path: '', pathMatch: 'full', redirectTo: 'login' },
	{
		path: 'login',
		loadComponent: () => import('./login/login').then(m => m.Login),
	},
	{
		path: 'dashboard',
		canActivate: [authGuard],
		loadComponent: () => import('./admin-dashboard/admin-dashboard').then(m => m.AdminDashboard),
	},
	{ path: '**', redirectTo: 'login' },
];
