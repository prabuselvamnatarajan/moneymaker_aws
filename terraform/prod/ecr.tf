# Private registry for prod. The deploy workflow copies the images that
# passed CI from Docker Hub into these repositories under the commit SHA,
# so EKS never depends on Docker Hub pull limits for the app images.
data "aws_caller_identity" "current" {}

resource "aws_ecr_repository" "app" {
  for_each = toset(var.ecr_repositories)

  name                 = each.value
  image_tag_mutability = "IMMUTABLE"
  # Lets the destroy workflow remove repositories that still hold images.
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each = aws_ecr_repository.app

  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the newest ${var.ecr_keep_images} images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = var.ecr_keep_images
      }
      action = { type = "expire" }
    }]
  })
}
