export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
  feedback: {
    hasMinLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSpecialChar: boolean;
  };
}

export function validatePassword(
  password: string,
  minLength: number = 8,
  requireComplexity: boolean = false
): PasswordValidationResult {
  const errors: string[] = [];
  const feedback = {
    hasMinLength: password.length >= minLength,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSpecialChar: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };

  if (!feedback.hasMinLength) {
    errors.push(`Password must be at least ${minLength} characters long`);
  }

  if (requireComplexity) {
    if (!feedback.hasUppercase) {
      errors.push("Password must contain at least one uppercase letter");
    }
    if (!feedback.hasLowercase) {
      errors.push("Password must contain at least one lowercase letter");
    }
    if (!feedback.hasNumber) {
      errors.push("Password must contain at least one number");
    }
    if (!feedback.hasSpecialChar) {
      errors.push("Password must contain at least one special character");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    feedback,
  };
}

export function validatePasswordMatch(
  password: string,
  confirmPassword: string
): boolean {
  return password === confirmPassword && password.length > 0;
}
