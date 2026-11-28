variable "aws_region" {
  description = "Region for the state bucket (use the same region as terraform/prod)"
  type        = string
  default     = "ap-south-1"
}

variable "state_bucket_name" {
  description = "Globally unique S3 bucket name for Terraform state"
  type        = string
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the deploy role, as owner/name"
  type        = string
  default     = "prabuselvamnatarajan/moneymaker_aws"
}

variable "github_environments" {
  description = "GitHub Environments whose jobs may assume the role"
  type        = list(string)
  default     = ["production", "production-infra"]
}

variable "create_github_oidc_provider" {
  description = "Set false if this AWS account already has the token.actions.githubusercontent.com OIDC provider"
  type        = bool
  default     = true
}

variable "role_name" {
  description = "IAM role name assumed by GitHub Actions"
  type        = string
  default     = "moneymaker-github-actions"
}
