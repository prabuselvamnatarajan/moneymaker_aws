output "state_bucket" {
  description = "Set as GitHub repository variable TF_STATE_BUCKET"
  value       = aws_s3_bucket.tf_state.bucket
}

output "github_actions_role_arn" {
  description = "Set as GitHub repository variable AWS_ROLE_ARN"
  value       = aws_iam_role.github_actions.arn
}

output "aws_region" {
  description = "Set as GitHub repository variable AWS_REGION"
  value       = var.aws_region
}
