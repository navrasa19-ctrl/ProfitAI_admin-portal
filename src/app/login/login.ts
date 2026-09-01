import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  submitting = false;
  errorMessage = '';
  twoFactorToken = '';
  twoFactorCode = '';

  submit(): void {
    if (this.form.invalid || this.submitting) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting = true;
    this.errorMessage = '';
    this.authService.login(this.form.getRawValue()).subscribe({
      next: response => {
        if ('twoFactorRequired' in response && response.twoFactorRequired) {
          this.twoFactorToken = response.tempToken;
          this.submitting = false;
          return;
        }
        this.verifyAdminAndEnter();
      },
      error: error => {
        this.submitting = false;
        this.errorMessage = error.error?.error || 'Unable to sign in. Check your email and password.';
      },
    });
  }

  verifyTwoFactor(): void {
    if (!/^\d{6}$/.test(this.twoFactorCode) || this.submitting) return;
    this.submitting = true;
    this.errorMessage = '';
    this.authService.loginWithTwoFactor(this.twoFactorToken, this.twoFactorCode).subscribe({
      next: () => this.verifyAdminAndEnter(),
      error: error => {
        this.submitting = false;
        this.errorMessage = error.error?.error || 'Invalid authentication code.';
      },
    });
  }

  // Being a logged-in user isn't enough for this portal - the account must carry
  // the ADMIN role. We confirm that against /v1/admin/me before entering the console.
  private verifyAdminAndEnter(): void {
    this.authService.getAdminProfile().subscribe({
      next: () => {
        this.submitting = false;
        this.router.navigateByUrl('/dashboard');
      },
      error: () => {
        this.submitting = false;
        this.authService.logout();
        this.errorMessage = 'This account does not have admin access.';
      },
    });
  }

  backToPassword(): void {
    this.twoFactorToken = '';
    this.twoFactorCode = '';
    this.errorMessage = '';
  }
}
