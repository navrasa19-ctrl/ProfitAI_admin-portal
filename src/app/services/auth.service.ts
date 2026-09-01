import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

export interface TwoFactorChallenge {
  twoFactorRequired: true;
  tempToken: string;
}

export interface AdminMeResponse {
  id: string;
  email: string;
  name: string;
  role: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly tokenKey = 'profit-ai-admin-access-token';

  login(request: LoginRequest): Observable<LoginResponse | TwoFactorChallenge> {
    return this.http.post<LoginResponse | TwoFactorChallenge>(`${environment.apiUrl}/v1/auth/login`, request).pipe(
      tap(response => {
        if ('accessToken' in response) localStorage.setItem(this.tokenKey, response.accessToken);
      })
    );
  }

  loginWithTwoFactor(tempToken: string, code: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${environment.apiUrl}/v1/auth/login/2fa`, { tempToken, code }).pipe(
      tap(response => localStorage.setItem(this.tokenKey, response.accessToken))
    );
  }

  // Confirms the signed-in user actually holds the ADMIN role.
  // TradeController currently accepts any authenticated user (see Phase "risk controls"
  // in the plan) so this client-side gate is a stop-gap, not a security boundary -
  // the backend role check on /api/v1/admin/** is the real one.
  getAdminProfile(): Observable<AdminMeResponse> {
    return this.http.get<AdminMeResponse>(`${environment.apiUrl}/v1/admin/me`);
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  logout(): void {
    localStorage.removeItem(this.tokenKey);
  }
}
