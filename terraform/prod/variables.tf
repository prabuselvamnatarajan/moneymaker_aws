variable "aws_region" {
  description = "AWS region for EKS, ACM (regional), and EFS"
  type        = string
  default     = "ap-south-1"
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "moneymaker-prod"
}

variable "vpc_cidr" {
  description = "CIDR for the prod VPC"
  type        = string
  default     = "10.40.0.0/16"
}

variable "availability_zones" {
  description = "AZs for public/private subnets (must be length 2 or 3)"
  type        = list(string)
  default     = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
}

variable "node_instance_types" {
  description = "EC2 instance types for the managed node group"
  type        = list(string)
  default     = ["t3.xlarge"]
}

variable "node_desired_size" {
  description = "Desired node count"
  type        = number
  default     = 3
}

variable "node_min_size" {
  description = "Minimum node count"
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = "Maximum node count"
  type        = number
  default     = 6
}

variable "domain_name" {
  description = "Public hostname for the MoneyMaker Ingress"
  type        = string
  default     = "algo.mrcobra.link"
}

variable "route53_zone_name" {
  description = "Existing Route 53 hosted zone name (must already exist)"
  type        = string
  default     = "mrcobra.link"
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version"
  type        = string
  default     = "1.29"
}

variable "alb_dns_name" {
  description = "ALB DNS name from kubectl get ingress (empty until Ingress exists)"
  type        = string
  default     = ""
}

variable "alb_zone_id" {
  description = "Canonical hosted zone ID of the ALB (empty until Ingress exists)"
  type        = string
  default     = ""
}
