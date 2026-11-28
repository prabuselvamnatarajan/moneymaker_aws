output "cluster_name" {
  description = "EKS cluster name"
  value       = aws_eks_cluster.prod.name
}

output "cluster_endpoint" {
  description = "EKS API endpoint"
  value       = aws_eks_cluster.prod.endpoint
}

output "cluster_certificate_authority_data" {
  description = "Base64-encoded cluster CA"
  value       = aws_eks_cluster.prod.certificate_authority[0].data
  sensitive   = true
}

output "configure_kubectl" {
  description = "Command to update kubeconfig for this cluster"
  value       = "aws eks update-kubeconfig --region ${var.aws_region} --name ${aws_eks_cluster.prod.name}"
}

output "acm_certificate_arn" {
  description = "ACM certificate ARN for the Ingress (published to the cluster by install-cluster-addons.sh)"
  value       = aws_acm_certificate_validation.algo.certificate_arn
}

output "efs_file_system_id" {
  description = "EFS file system ID (used for the efs-sc StorageClass)"
  value       = aws_efs_file_system.shared.id
}

output "efs_mongo_init_access_point_id" {
  description = "EFS access point for Mongo bootstrap signal"
  value       = aws_efs_access_point.mongo_init.id
}

output "efs_backtest_data_access_point_id" {
  description = "EFS access point for shared backtest volume"
  value       = aws_efs_access_point.backtest_data.id
}

output "alb_controller_role_arn" {
  description = "IAM role ARN for AWS Load Balancer Controller (Helm --set serviceAccount.annotations)"
  value       = aws_iam_role.alb_controller.arn
}

output "vpc_id" {
  value = aws_vpc.prod.id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "route53_zone_id" {
  value = data.aws_route53_zone.main.zone_id
}

output "aws_region" {
  value = var.aws_region
}

output "domain_name" {
  value = var.domain_name
}

output "ecr_registry" {
  description = "ECR registry host the prod overlay pulls images from"
  value       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
}

output "ecr_repositories" {
  description = "Custom images the deploy copies into ECR"
  value       = sort(keys(aws_ecr_repository.app))
}
