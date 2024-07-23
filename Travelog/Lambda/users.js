/** @format */

'use strict';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { CognitoIdentityProviderClient, SignUpCommand, AdminGetUserCommand, AdminCreateUserCommand, AdminDeleteUserCommand, AdminSetUserPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import { v4 as uuidv4 } from 'uuid';
import { BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
import axios from 'axios';
import fs from 'fs/promises';
import XLSX from 'xlsx';
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";



import ddb from "@aws-sdk/lib-dynamodb";
import * as dynamodb from "@aws-sdk/client-dynamodb";

const docClient = new dynamodb.DynamoDBClient();

const ddbDocClient = ddb.DynamoDBDocumentClient.from(docClient, {
    marshallOptions: {
        removeUndefinedValues: true,
    },
});



const query_dynamo = async (params) => {
    try {
        let command = new ddb.QueryCommand(params);
        const data = await ddbDocClient.send(command);
        return data;
    }
    catch (err) {
        console.log(params, err);
        throw new Error(err);
    }
};

const scan_dynamo = async (params) => {
    try {
        let command = new ddb.ScanCommand(params);
        const data = await ddbDocClient.send(command);
        return data;
    }
    catch (err) {
        console.log(params, err);
        throw new Error(err);
    }
};

const insert_into_dynamo = async (params) => {
    try {
        let command = new ddb.PutCommand(params);
        await ddbDocClient.send(command);
        return "SUCCESS";
    }
    catch (err) {
        console.log(params, err);
        throw new Error(err);
    }
};

const update_dynamo = async (params) => {
    try {
        let command = new ddb.UpdateCommand(params);
        await ddbDocClient.send(command);
        return "SUCCESS";
    }
    catch (err) {
        console.log(params, err);
        throw new Error(err);
    }
};

export const delete_dynamo = async (params) => {
    try {
        await ddbDocClient.send(new ddb.DeleteCommand(params));
        return 'SUCCESS';
    }
    catch (err) {
        console.log(params, err);
        return 'ERROR';
    }
};



/* master query all */

export const get_query_all_data = async (event) => {
    let response = { Count: 0, Items: [] };
    const query_data = async (event) => {
        const results = await ddbDocClient.send(new ddb.QueryCommand(event));
        if (results.LastEvaluatedKey) {
            response.Count += results.Count;
            response.Items = response.Items.concat(results.Items);
            event.ExclusiveStartKey = results.LastEvaluatedKey;
            return await query_data(event);
        }
        else {
            response.Count += results.Count;
            response.Items = response.Items.concat(results.Items);
            return response;
        }
    };
    return await query_data(event);
};

/* lambda invoke functions */

export const invokeLambda = async (payload, funcName, event_type) => {
    const command = new InvokeCommand({
        FunctionName: funcName,
        Payload: JSON.stringify(payload),
        InvocationType: event_type, //'RequestResponse', // "Event"
    });
    await new LambdaClient().send(command);
    return 'SUCCESS';
};


/* check empty field functions */

export const check_empty_fields = (event) => {
    let checkEmptyFields = true;
    for (const field in event) {
        if (typeof event[field] == 'string') {
            if (event[field].trim().length == 0) {
                delete event[field];
            }
            else {
                event[field] = event[field].trim();
            }
        }
    }
    return checkEmptyFields;
};


export const get_batch_data = async (details, tablename, is_true, ProjectionExpression) => {
    let batches = [];
    let team_ids = details;
    while (team_ids.length) {
        batches.push(team_ids.splice(0, 25));
    }
    let all_resposne = [];
    for (let i = 0; i < batches.length; i++) {
        let params = {
            RequestItems: {
                [tablename]: {
                    Keys: batches[i],
                },
            },
        };
        if (is_true) {
            params.RequestItems[tablename].ProjectionExpression = ProjectionExpression;
        }
        const results = await ddbDocClient.send(new ddb.BatchGetCommand(params));
        all_resposne.push(results.Responses[tablename]);
    }
    return all_resposne.flat(Infinity);
};



/******************************************************************************************************************************************************************************************************************/


export const create_user = async (event) => {
    try {
        if (await check_empty_fields(event)) {
            let checkUserAlreadyExist = {
                TableName: "tl_app_user",
                IndexName: "phone_number-user_status-index",
                KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
                ExpressionAttributeValues: {
                    ":phone_number": event.phone_number,
                    ":user_status": "ACTIVE"
                }
            };
            let UserDetails = await query_dynamo(checkUserAlreadyExist);
            // if (UserDetails.Count > 0) {
            //     return { Status: "ERROR", Message: "User Already Exists !!!" };
            if (UserDetails.Count > 0 && UserDetails.Items.user_country == "country" && UserDetails.Items.user_state == "state") {
                const update_params = {
                    TableName: "tl_app_user",
                    Key: {
                        user_id: UserDetails.Items[0].user_id
                    },
                    UpdateExpression: 'SET fcm_token = :fcm_token , app_version = :app_version , mobile_details = :mobile_details , user_country = :user_country , user_state = :user_state , user_status = :user_status , user_name =:user_name ',
                    ExpressionAttributeValues: {
                        ':fcm_token': event.fcm_token,
                        ':app_version': event.app_version,
                        ":mobile_details": event.mobile_details,
                        ":user_country": event.user_country,
                        ":user_state": event.user_state,
                        ":user_status": "ACTIVE",
                        ":user_name": event.user_name
                    }
                };
                await update_dynamo(update_params);
            }
            else {
                let inserUser = {
                    TableName: "tl_app_user",
                    Item: {
                        user_id: uuidv4(),
                        user_name: event.user_name,
                        country_code: event.country_code,
                        phone_number: event.phone_number,
                        fcm_token: event.fcm_token,
                        subscription_status: "DEACTIVATED",
                        mobile_details: event.mobile_details,
                        profile_image: event.profile_image || "",
                        app_version: event.app_version,
                        user_status: 'ACTIVE',
                        user_state: event.user_state,
                        user_country: event.user_country
                    }
                };
                let createResponse = await insert_into_dynamo(inserUser);
                if (createResponse == "SUCCESS") {
                    return { Status: "SUCCESS", Message: "User Created Successfully!!!" };
                }
                else {
                    return { Status: "ERROR", Message: "Failed To Create" };
                }
            }
        }
        else {
            return { Status: "ERROR", Message: "User already exists!" };
        }
    }
    catch (error) {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};






/***update_fcm_token***/
export const update_fcm_token = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserExist = {
            TableName: "tl_app_user",
            KeyConditionExpression: "user_id = :user_id",
            ExpressionAttributeValues: {
                ":user_id": event.user_id,
                ":user_status": "ACTIVE"
            },
            FilterExpression: "user_status = :user_status"
        };
        let UserDetails = await query_dynamo(checkUserExist);
        if (UserDetails.Count > 0) {
            let updateStatus = {
                TableName: "tl_app_user",
                Key: {
                    user_id: UserDetails.Items[0].user_id
                },
                UpdateExpression: 'SET fcm_token = :fcm_token , app_version = :app_version , mobile_details = :mobile_details',
                ExpressionAttributeValues: {
                    ':fcm_token': event.fcm_token,
                    ':app_version': event.app_version,
                    ":mobile_details": event.mobile_details
                }
            };
            await update_dynamo(updateStatus);
            return { Status: "SUCCESS", Message: "FCM token and APP version updated successfully!" };
        }
        else {
            return { Status: "ERROR", Message: "Failed to update" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};






export const edit_user_profile = async (event) => {
    if (await check_empty_fields(event)) {
        const checkuserstatus = {
            TableName: "tl_app_user",
            KeyConditionExpression: "user_id = :user_id",
            ExpressionAttributeValues: {
                ":user_id": event.user_id,
            },
        };
        const userStatus = await query_dynamo(checkuserstatus);
        if (userStatus.Count > 0) {
            const updateStatus = {
                TableName: "tl_app_user",
                Key: {
                    user_id: userStatus.Items[0].user_id
                },
                UpdateExpression: 'SET user_name = :user_name , profile_image = :profile_image',
                ExpressionAttributeValues: {
                    ':user_name': event.user_name,
                    ':profile_image': event.profile_image || " "
                }
            };
            await update_dynamo(updateStatus);
            return { Status: "SUCCESS", Message: "SUCCESSFULLY Edited the profile!" };
        }
        else {
            return { Status: "ERROR", Message: "Failed to edit" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};








/***get_current_user***/
export const get_current_user = async (event) => {
    if (await check_empty_fields(event)) {
        const checkUserAlreadyExist = {
            TableName: "tl_app_user",
            IndexName: "phone_number-user_status-index",
            KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
                ":user_status": "ACTIVE"
            },
            ScanIndexForward: false,
            Limit: 100
        };
        const UserDetails = await get_query_all_data(checkUserAlreadyExist);
        if (UserDetails.Count > 0) {
            // UserDetails.Items[0].s3Details = {
            //     "post_bucket_name": constant.s3.bucket_name,
            //     "access_key_id": constant.s3.access_key_id,
            //     "secret_access_key": constant.s3.secret_access_key,
            //     "region": constant.s3.region,
            //     "folder_name": constant.s3.folder_name
            // };
            return { Status: "SUCCESS", Data: UserDetails.Items };
        }

        else {
            return { Status: "ERROR", Message: "User Not Found!!!" };
        }
    }
};

/***create_cotraveller***/
export const create_cotraveller = async (event) => {
    if (await check_empty_fields(event)) {
        let user_exists_status = false;
        let checkUserAlreadyExist = {
            TableName: "tl_app_user",
            IndexName: "phone_number-user_status-index",
            KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
                ":user_status": "ACTIVE"
            }
        };
        let UserDetails = await query_dynamo(checkUserAlreadyExist);
        if (UserDetails.Items.length > 0) {
            user_exists_status = true;
        }
        let checkpoststatus = {
            TableName: "tl_travelogues",
            IndexName: "travelogue_id-post_status-index",
            KeyConditionExpression: "travelogue_id = :travelogue_id and post_status = :post_status",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":post_status": "OPEN",
                ":travelogue_status": "ACTIVE"
            },
            FilterExpression: "travelogue_status = :travelogue_status",
        };
        let statusofpost = await query_dynamo(checkpoststatus);
        if (statusofpost.Count > 0) {
            let checktraveller = {
                TableName: "tl_users_access",
                IndexName: "travelogue_id-phone_number-index",
                KeyConditionExpression: "travelogue_id = :travelogue_id and phone_number = :phone_number",
                ExpressionAttributeValues: {
                    ":travelogue_id": statusofpost.Items[0].travelogue_id,
                    ":phone_number": event.phone_number,
                    ":user_status": "ACTIVE"
                },
                FilterExpression: "user_status = :user_status"
            };
            let cotravellerDetails = await query_dynamo(checktraveller);
            if (cotravellerDetails.Count === 0) {
                let insertUser = {
                    TableName: "tl_app_user",
                    Item: {
                        user_id: uuidv4(),
                        user_name: event.user_name,
                        country_code: event.country_code,
                        phone_number: event.phone_number,
                        user_country: "country",
                        user_state: "state",
                        fcm_token: event.fcm_token || "",
                        subscription_status: "DEACTIVATED",
                        mobile_details: event.mobile_details || "",
                        app_version: event.app_version || "",
                        user_status: 'ACTIVE'

                    }
                };

                if (!user_exists_status) {
                    await insert_into_dynamo(insertUser);
                }

                let insertMapping = {
                    TableName: "tl_users_access",
                    Item: {
                        mapping_id: uuidv4(),
                        user_id: user_exists_status == false ? insertUser.Item.user_id : UserDetails.Items[0].user_id,
                        travelogue_id: statusofpost.Items[0].travelogue_id,
                        user_name: event.user_name,
                        phone_number: event.phone_number,
                        account_type: "COTRAVELLER",
                        user_status: 'ACTIVE',
                        travelogue_status: statusofpost.Items[0].travelogue_status,
                        fcm_token: insertUser.Item.fcm_token || ""
                    }
                };
                let mappingResponse = await insert_into_dynamo(insertMapping);
                if (mappingResponse === "SUCCESS") {
                    update_dynamo({
                        TableName: "tl_app_user",
                        Key: {
                            user_id: user_exists_status == false ? insertUser.Item.user_id : UserDetails.Items[0].user_id
                        },
                        UpdateExpression: 'Add type_Cotraveller_count :type_Cotraveller_count',
                        ExpressionAttributeValues: {
                            ':type_Cotraveller_count': 1,
                        }
                    });
                    let invocation_params = {
                        command: "subscribeall_topic",
                        travelogue_id: statusofpost.Items[0].travelogue_id
                    };
                    await invokeLambda(invocation_params, "Travelogue_notification", "Event");
                    let updateSubCount = {
                        TableName: "tl_travelogues",
                        Key: {
                            travelogue_id: statusofpost.Items[0].travelogue_id
                        },
                        UpdateExpression: 'Add cotraveller_count :cotraveller_count',
                        ExpressionAttributeValues: {
                            ':cotraveller_count': 1,
                        }
                    };
                    await update_dynamo(updateSubCount);
                    return { Status: "SUCCESS", Message: "Cotraveller Created Successfully!!" };
                }
                else {
                    return { Status: "ERROR", Message: "An error occurred while creating the cotraveller!!!" };
                }
            }

            else {
                return { Status: "ERROR", Message: "The User is already a part of this Travelog" };
            }
        }
        else {
            return { Status: "ERROR", Message: "Travelog is closed, you cannot add a new cotraveller" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Fields Occurred" };
    }
};

/***delete_cotraveller***/
export const delete_cotraveller = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserAlreadyExist = {
            TableName: "tl_users_access",
            IndexName: "phone_number-user_status-index",
            KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
                ":user_status": "ACTIVE",
                ":travelogue_id": event.travelogue_id,
                ":account_type": "COTRAVELLER"
            },
            FilterExpression: "travelogue_id = :travelogue_id and account_type = :account_type"
        };
        let UserDetails = await query_dynamo(checkUserAlreadyExist);
        if (UserDetails.Count > 0) {
            update_dynamo({
                TableName: "tl_users_access",
                Key: {
                    mapping_id: UserDetails.Items[0].mapping_id
                },
                UpdateExpression: 'SET user_status = :user_status',
                ExpressionAttributeValues: {
                    ':user_status': "DEACTIVATED"
                }
            });
            update_dynamo({
                TableName: "tl_app_user",
                Key: {
                    user_id: UserDetails.Items[0].user_id
                },
                UpdateExpression: 'Add type_Cotraveller_count :type_Cotraveller_count',
                ExpressionAttributeValues: {
                    ':type_Cotraveller_count': -1,
                }
            });
            let updateSubCount = {
                TableName: "tl_travelogues",
                Key: {
                    travelogue_id: UserDetails.Items[0].travelogue_id
                },
                UpdateExpression: 'Add cotraveller_count :cotraveller_count',
                ExpressionAttributeValues: {
                    ':cotraveller_count': -1,
                }
            };

            try {
                await update_dynamo(updateSubCount);
                return { Status: "SUCCESS", Message: "user deactivated successfully!!!" };
            }
            catch (error) {
                return { Status: "ERROR", Message: "Failed to deactivate user" };
            }
        }
        else {
            return { Status: "ERROR", Message: "user not found" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Fields Occurred" };
    }
};

/***create_viewer***/
export const create_viewer = async (event) => {
    if (await check_empty_fields(event)) {
        let user_exists_status = false;
        let checkUserAlreadyExist = {
            TableName: "tl_app_user",
            IndexName: "phone_number-user_status-index",
            KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
                ":user_status": "ACTIVE"
            }
        };
        let UserDetails = await query_dynamo(checkUserAlreadyExist);
        if (UserDetails.Items.length > 0) {
            user_exists_status = true;
        }
        let checkpoststatus = {
            TableName: "tl_travelogues",
            IndexName: "travelogue_id-post_status-index",
            KeyConditionExpression: "travelogue_id = :travelogue_id and post_status = :post_status",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":post_status": "OPEN",
                ":travelogue_status": "ACTIVE"
            },
            FilterExpression: "travelogue_status = :travelogue_status",
        };
        let statusofpost = await query_dynamo(checkpoststatus);
        if (statusofpost.Count > 0) {
            let checktraveller = {
                TableName: "tl_users_access",
                IndexName: "travelogue_id-phone_number-index",
                KeyConditionExpression: "travelogue_id = :travelogue_id and phone_number = :phone_number",
                ExpressionAttributeValues: {
                    ":travelogue_id": statusofpost.Items[0].travelogue_id,
                    ":phone_number": event.phone_number,
                    ":user_status": "ACTIVE"
                },
                FilterExpression: "user_status = :user_status"
            };
            let cotravellerDetails = await query_dynamo(checktraveller);
            if (cotravellerDetails.Count === 0) {
                let insertUser = {
                    TableName: "tl_app_user",
                    Item: {
                        user_id: uuidv4(),
                        user_name: event.user_name,
                        country_code: event.country_code,
                        phone_number: event.phone_number,
                        fcm_token: event.fcm_token || "",
                        subscription_status: "DEACTIVATED",
                        mobile_details: event.mobile_details || "",
                        app_version: event.app_version || "",
                        user_status: 'ACTIVE',
                    }
                };
                if (!user_exists_status) {
                    await insert_into_dynamo(insertUser);
                }

                let insertMapping = {
                    TableName: "tl_users_access",
                    Item: {
                        mapping_id: uuidv4(),
                        user_id: user_exists_status == false ? insertUser.Item.user_id : UserDetails.Items[0].user_id,
                        travelogue_id: statusofpost.Items[0].travelogue_id,
                        user_name: event.user_name,
                        phone_number: event.phone_number,
                        account_type: "VIEWER",
                        user_status: 'ACTIVE',
                        travelogue_status: statusofpost.Items[0].travelogue_status,
                        fcm_token: insertUser.Item.fcm_token || ""
                    }
                };
                let mappingResponse = await insert_into_dynamo(insertMapping);
                if (mappingResponse === "SUCCESS") {
                    update_dynamo({
                        TableName: "tl_app_user",
                        Key: {
                            user_id: user_exists_status == false ? insertUser.Item.user_id : UserDetails.Items[0].user_id
                        },
                        UpdateExpression: 'Add type_Viewer_count :type_Viewer_count',
                        ExpressionAttributeValues: {
                            ':type_Viewer_count': 1,
                        }
                    });
                    let invocation_params = {
                        command: "subscribeall_topic",
                        travelogue_id: statusofpost.Items[0].travelogue_id
                    };
                    await invokeLambda(invocation_params, "Travelogue_notification", "Event");
                    let updateSubCount = {
                        TableName: "tl_travelogues",
                        Key: {
                            travelogue_id: statusofpost.Items[0].travelogue_id
                        },
                        UpdateExpression: 'Add viewer_count :viewer_count',
                        ExpressionAttributeValues: {
                            ':viewer_count': 1,
                        }
                    };
                    await update_dynamo(updateSubCount);
                    return { Status: "SUCCESS", Message: "Viewer Created Successfully!!" };
                }
                else {
                    return { Status: "ERROR", Message: "An error occurred while creating the Viewer!!!" };
                }
            }

            else {
                return { Status: "ERROR", Message: "The User is already a part of this Travelog" };
            }
        }
        else {
            return { Status: "ERROR", Message: "Travelog is closed, you cannot add a new Viewer" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Fields Occurred" };
    }
};

/***delete_viewer***/
export const delete_viewer = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserAlreadyExist = {
            TableName: "tl_users_access",
            IndexName: "phone_number-user_status-index",
            KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
                ":user_status": "ACTIVE",
                ":travelogue_id": event.travelogue_id,
                ":account_type": "VIEWER"
            },
            FilterExpression: "travelogue_id = :travelogue_id and account_type = :account_type"
        };
        let UserDetails = await query_dynamo(checkUserAlreadyExist);
        if (UserDetails.Count > 0) {
            update_dynamo({
                TableName: "tl_users_access",
                Key: {
                    mapping_id: UserDetails.Items[0].mapping_id
                },
                UpdateExpression: 'SET user_status = :user_status',
                ExpressionAttributeValues: {
                    ':user_status': "DEACTIVATED"
                }
            });
            update_dynamo({
                TableName: "tl_app_user",
                Key: {
                    user_id: UserDetails.Items[0].user_id
                },
                UpdateExpression: 'Add type_Viewer_count :type_Viewer_count',
                ExpressionAttributeValues: {
                    ':type_Viewer_count': -1,
                }
            });
            let updateSubCount = {
                TableName: "tl_travelogues",
                Key: {
                    travelogue_id: UserDetails.Items[0].travelogue_id
                },
                UpdateExpression: 'Add viewer_count :viewer_count',
                ExpressionAttributeValues: {
                    ':viewer_count': -1,
                }
            };

            try {
                await update_dynamo(updateSubCount);
                return { Status: "SUCCESS", Message: "viewer deactivated successfully!!!" };
            }
            catch (error) {
                return { Status: "ERROR", Message: "Failed to deactivate viewer" };
            }
        }
        else {
            return { Status: "ERROR", Message: "viewer not found" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Fields Occurred" };
    }
};

/***travelogue_creation***/
export const travelogue_creation = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserAlreadyExist = {
            TableName: "tl_app_user",
            IndexName: "phone_number-user_status-index",
            KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
                ":user_status": "ACTIVE"
            }
        };
        let UserDetails = await query_dynamo(checkUserAlreadyExist);
        if (UserDetails.Count > 0) {
            let checkpoststatus = {
                TableName: "tl_travelogues",
                IndexName: "phone_number-post_status-index",
                KeyConditionExpression: "phone_number = :phone_number and post_status = :post_status",
                ExpressionAttributeValues: {
                    ":phone_number": event.phone_number,
                    ":post_status": "OPEN"
                },
            };
            let statusofpost = await query_dynamo(checkpoststatus);
            if (statusofpost.Count == 0) {
                let createtravelogue = {
                    TableName: "tl_travelogues",
                    Item: {
                        travelogue_id: uuidv4(),
                        user_id: UserDetails.Items[0].user_id,
                        phone_number: event.phone_number,
                        user_status: 'ACTIVE',
                        travelogue_image: event.travelogue_image || null,
                        travelogue_name: event.travelogue_name,
                        travelogue_description: event.travelogue_description,
                        travelogue_created_on: Math.floor(new Date().getTime() / 1000),
                        travelogue_created_by: UserDetails.Items[0].user_name,
                        travelogue_status: 'ACTIVE',
                        post_status: "OPEN",
                        travelogue_availability: "RESTRICTED",
                        travelogue_subscription_status: "FREE",
                        cotraveller_count: 0,
                        viewer_count: 0,
                        pov_count: 0,
                        post_count: 0,
                        state: event.state
                    }
                };
                let createResponse = await insert_into_dynamo(createtravelogue);
                if (createResponse == "SUCCESS") {
                    let mappinguser = {
                        TableName: "tl_users_access",
                        Item: {
                            mapping_id: uuidv4(),
                            travelogue_id: createtravelogue.Item.travelogue_id,
                            user_id: UserDetails.Items[0].user_id,
                            user_name: UserDetails.Items[0].user_name,
                            phone_number: UserDetails.Items[0].phone_number,
                            account_type: "OWNER",
                            user_status: UserDetails.Items[0].user_status,
                            travelogue_status: "ACTIVE",
                            fcm_token: UserDetails.Items[0].fcm_token
                        }
                    };
                    let mapusertotable = await insert_into_dynamo(mappinguser);
                    let invocation_params = {
                        command: "subscribe_topic",
                        topic: createtravelogue.Item.travelogue_id,
                        fcm_token: UserDetails.Items[0].fcm_token
                    };
                    await invokeLambda(invocation_params, "Travelogue_notification", "Event");
                    let updateSubCount = {
                        TableName: "tl_app_user",
                        Key: {
                            user_id: UserDetails.Items[0].user_id
                        },
                        UpdateExpression: 'ADD type_owner_count :type_owner_count',
                        ExpressionAttributeValues: {
                            ':type_owner_count': 1,
                        }
                    };
                    await update_dynamo(updateSubCount);
                    if (mapusertotable == "SUCCESS") {
                        return { Status: "SUCCESS", Message: "Travelog created successfully !!!" };
                    }
                    else {
                        return { Status: "ERROR", Message: "Failed to map user" };
                    }
                }
                else {
                    return { Status: "ERROR", Message: "Failed to create travelog" };
                }
            }
            else {
                return { Status: "ERROR", Message: "Travelog is still open. Please close it to create a new travelogue" };
            }
        }
        else {
            return { Status: "ERROR", Message: "No user found" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Missing mandatory fields" };
    }
};

/***extrenal_query***/
export const extrenal_query = async (travelogue_id) => {
    let final_result = [];
    let travelogueIds = [];
    if (travelogue_id != undefined && travelogue_id.length > 0) {
        for (let i = 0; i < travelogue_id.length; i++) {
            let getUserDetails = {
                TableName: 'tl_users_access',
                IndexName: "travelogue_id-index",
                KeyConditionExpression: 'travelogue_id = :travelogue_id',
                ExpressionAttributeValues: {
                    ':travelogue_id': travelogue_id[i].travelogue_id,
                },
            };
            let travelogDetails = await query_dynamo(getUserDetails);
            if (travelogDetails.Count > 0) {
                for (let m = 0; m < travelogDetails.Items.length; m++) {
                    let index = travelogueIds.indexOf(travelogDetails.Items[m].travelogue_id);
                    if (index > -1) {
                        final_result[index].travelogue_users = final_result[index].travelogue_users.concat({ user_name: travelogDetails.Items[m].user_name, phone_number: travelogDetails.Items[m].phone_number, account_type: travelogDetails.Items[m].account_type });
                    }
                    else {
                        final_result.push({ travelogue_id: travelogue_id[i].travelogue_id, travelogue_users: [{ user_name: travelogDetails.Items[m].user_name, phone_number: travelogDetails.Items[m].phone_number, account_type: travelogDetails.Items[m].account_type }] });
                        travelogueIds.push(travelogue_id[i].travelogue_id);
                    }
                }
            }
        }
    }
    return final_result;
};

/***list_travelog_by_id***/
export const list_travelog_by_id = async (event) => {
    if (await check_empty_fields(event)) {
        let checkpoststatus = {
            TableName: "tl_travelogues",
            KeyConditionExpression: "travelogue_id = :travelogue_id",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":travelogue_status": "ACTIVE"
            },
            FilterExpression: "travelogue_status = :travelogue_status"
        };
        let postDetails = await get_query_all_data(checkpoststatus);
        if (postDetails.Count > 0) {
            return { Status: "SUCCESS", Data: postDetails.Items };
        }
        else {
            return { Status: "ERROR", Message: "Travelogs Not Found!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};

/***list_travelogues***/
export const list_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserAlreadyExist = {
            TableName: "tl_app_user",
            IndexName: "phone_number-user_status-index",
            KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
                ":user_status": "ACTIVE"
            }
        };
        let UserDetails = await query_dynamo(checkUserAlreadyExist);
        if (UserDetails.Count > 0) {
            let getTravelogueDetails = {
                TableName: "tl_travelogues",
                IndexName: "user_id-travelogue_status-index",
                KeyConditionExpression: "user_id = :user_id and travelogue_status = :travelogue_status",
                ExpressionAttributeValues: {
                    ":user_id": UserDetails.Items[0].user_id,
                    ":travelogue_status": "ACTIVE"
                }
            };
            let travelogueDetails = await query_dynamo(getTravelogueDetails);
            if (travelogueDetails.Count > 0) {
                return { Status: "SUCCESS", Data: travelogueDetails.Items };
            }
            else {
                return { Status: "ERROR", Message: "No Travelogs Found!!!" };
            }
        }
        else {
            return { Status: "ERROR", Message: " User Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***list_travelogues_of_user***/
export const list_travelogues_of_user = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserAlreadyExist = {
            TableName: "tl_users_access",
            IndexName: "phone_number-user_status-index",
            KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
            FilterExpression: "travelogue_status = :travelogue_status and account_type <> :account_type",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
                ":user_status": "ACTIVE",
                ":travelogue_status": "ACTIVE",
                ":account_type": "AGENT"
            },
            ProjectionExpression: "travelogue_id,account_type,travelogue_status"
        };
        let UserDetails = await get_query_all_data(checkUserAlreadyExist);
        if (UserDetails.Count > 0) {
            let travelogueIds = [];
            for (let i = 0; i < UserDetails.Items.length; i++) {
                travelogueIds.push(UserDetails.Items[i].travelogue_id);
            }
            travelogueIds = [...new Set(travelogueIds.map((s) => { return { travelogue_id: s } }))];
            if (travelogueIds.length > 0) {
                let travelogueDetails = await get_batch_data(travelogueIds, "tl_travelogues", true, "travelogue_id,user_id,post_status,travelogue_created_on,travelogue_description,travelogue_subscription_status,travelogue_end_date,phone_number,travelogue_name,travelogue_status,travelogue_created_by,user_status,post_count,pov_count,cotraveller_count,viewer_count");
                for (let m = 0; m < UserDetails.Items.length; m++) {
                    if (travelogueDetails.length > 0) {
                        let trvlIndex = travelogueDetails.findIndex((d) => d.travelogue_id == UserDetails.Items[m].travelogue_id);
                        if (trvlIndex > -1) {
                            UserDetails.Items[m] = {
                                ...UserDetails.Items[m],
                                ...travelogueDetails[trvlIndex]
                            };
                        }
                        else {
                            delete UserDetails.Items[m];
                        }
                    }
                }
            }
            for (let s = 0; s < UserDetails.Items.length; s++) {
                let invocation_params = {
                    command: "subscribeall_topic",
                    travelogue_id: UserDetails.Items[s].travelogue_id,
                };
                await invokeLambda(invocation_params, "Travelogue_notification", "Event");
                return { Status: "SUCCESS", data: UserDetails.Items.filter(Boolean) };
            }
        }
        else {
            return { Status: "ERROR", Message: "NO Travelogs Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};








/***update_travelogue_status***/
export const update_travelogue_status = async (event) => {
    if (await check_empty_fields(event)) {
        let checkpoststatus = {
            TableName: "tl_travelogues",
            KeyConditionExpression: "travelogue_id = :travelogue_id",
            FilterExpression: "travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":travelogue_status": "ACTIVE"
            }
        };
        let statusofpost = await query_dynamo(checkpoststatus);
        if (statusofpost.Count > 0) {
            let UpdateExpression = "set ";
            let ExpressionAttributeValues = {};
            for (const key in event) {
                if (key == "post_status" || key == "travelogue_status") {
                    UpdateExpression += `${key} = :${key} ,`;
                    ExpressionAttributeValues[`:${key}`] = event[key];
                }
            }
            UpdateExpression = UpdateExpression.slice(0, -1);
            let updatestatus = {
                TableName: "tl_travelogues",
                Key: {
                    travelogue_id: statusofpost.Items[0].travelogue_id
                },
                UpdateExpression: UpdateExpression,
                ExpressionAttributeValues: ExpressionAttributeValues
            };
            let updatedetails = {
                TableName: "tl_travelogues",
                Key: {
                    travelogue_id: statusofpost.Items[0].travelogue_id
                },
                UpdateExpression: 'SET travelogue_end_date = :travelogue_end_date',
                ExpressionAttributeValues: {
                    ':travelogue_end_date': Math.floor(new Date().getTime() / 1000)
                }
            };
            try {
                await update_dynamo(updatestatus);
                await update_dynamo(updatedetails);
                return { Status: "SUCCESS", Message: "Travelog status updated successfully!!!" };
            }
            catch (error) {
                return { Status: "ERROR", Message: "Failed to update Travelog status: " };
            }
        }
        else {
            return { Status: "ERROR", Message: "Travelog has been Closed or Terminated" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Fields Occurred" };
    }
};

/***close_travelogue_status***/
export const close_travelogue_status = async (event) => {
    if (await check_empty_fields(event)) {
        let checkpoststatus = {
            TableName: "tl_travelogues",
            KeyConditionExpression: "travelogue_id = :travelogue_id",
            FilterExpression: "travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":travelogue_status": "ACTIVE"
            }
        };
        let statusofpost = await query_dynamo(checkpoststatus);
        if (statusofpost.Count > 0) {
            let updatestatus = {
                TableName: "tl_travelogues",
                Key: {
                    travelogue_id: statusofpost.Items[0].travelogue_id
                },
                UpdateExpression: 'SET post_status = :post_status',
                ExpressionAttributeValues: {
                    ':post_status': "CLOSED"
                }
            };
            let updatedetails = {
                TableName: "tl_travelogues",
                Key: {
                    travelogue_id: statusofpost.Items[0].travelogue_id
                },
                UpdateExpression: 'SET travelogue_end_date = :travelogue_end_date',
                ExpressionAttributeValues: {
                    ':travelogue_end_date': Math.floor(new Date().getTime() / 1000)
                }
            };
            try {
                await update_dynamo(updatestatus);
                await update_dynamo(updatedetails);
                let invocation_params = {
                    command: "send_to_topic",
                    topic: statusofpost.Items[0].travelogue_id,
                    title: "Travelog",
                    message: "Travelog Closed Successfully"
                };
                await invokeLambda(invocation_params, "Travelogue_notification", "Event");
                return { Status: "SUCCESS", Message: "Travelog Closed successfully!!!" };
            }
            catch (error) {
                return { Status: "ERROR", Message: "Failed to close Travelog status: " };
            }
        }
        else {
            return { Status: "ERROR", Message: "Travelog has been Closed or Terminated" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Fields Occurred" };
    }
};

/***delete_travelogue_status***/
export const delete_travelogue_status = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserExist = {
            TableName: "tl_users_access",
            IndexName: "phone_number-user_status-index",
            KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
                ":user_status": "ACTIVE",
                ":travelogue_id": event.travelogue_id
            },
            FilterExpression: "travelogue_id = :travelogue_id"
        };
        let UserDetails = await query_dynamo(checkUserExist);
        if (UserDetails.Count > 0) {
            let checkpoststatus = {
                TableName: "tl_travelogues",
                KeyConditionExpression: "travelogue_id = :travelogue_id",
                FilterExpression: "travelogue_status = :travelogue_status",
                ExpressionAttributeValues: {
                    ":travelogue_id": UserDetails.Items[0].travelogue_id,
                    ":travelogue_status": "ACTIVE"
                }
            };
            let statusofpost = await query_dynamo(checkpoststatus);
            if (statusofpost.Count > 0) {
                update_dynamo({
                    TableName: "tl_travelogues",
                    Key: {
                        travelogue_id: statusofpost.Items[0].travelogue_id
                    },
                    UpdateExpression: 'SET travelogue_status = :travelogue_status',
                    ExpressionAttributeValues: {
                        ':travelogue_status': "DEACTIVATED"
                    }
                });
                update_dynamo({
                    TableName: "tl_travelogues",
                    Key: {
                        travelogue_id: statusofpost.Items[0].travelogue_id
                    },
                    UpdateExpression: 'SET travelogue_end_date = :travelogue_end_date',
                    ExpressionAttributeValues: {
                        ':travelogue_end_date': Math.floor(new Date().getTime() / 1000)
                    }
                });
                update_dynamo({
                    TableName: "tl_users_access",
                    Key: {
                        mapping_id: UserDetails.Items[0].mapping_id
                    },
                    UpdateExpression: 'SET travelogue_status = :travelogue_status',
                    ExpressionAttributeValues: {
                        ':travelogue_status': "DEACTIVATED"
                    }
                });
                let updateownercount = {
                    TableName: "tl_app_user",
                    Key: {
                        user_id: UserDetails.Items[0].user_id
                    },
                    UpdateExpression: 'ADD type_owner_count  :type_owner_count',
                    ExpressionAttributeValues: {
                        ':type_owner_count': -1,
                    }
                };
                try {
                    await update_dynamo(updateownercount);
                    let invocation_params = {
                        command: "send_to_topic",
                        topic: statusofpost.Items[0].travelogue_id,
                        title: "Travelog",
                        message: "Travelog Deleted Successfully"
                    };
                    await invokeLambda(invocation_params, "Travelogue_notification", "Event");
                    return { Status: "SUCCESS", Message: "Travelog status updated successfully!!!" };
                }
                catch (error) {
                    return { Status: "ERROR", Message: "Failed to update Travelog status: " };
                }
            }
            else {
                return { Status: "ERROR", Message: "Travelog has been Closed or Terminated" };
            }
        }
        else {
            return { Status: "ERROR", Message: "User does not exist" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Fields Occurred" };
    }
};

/***update_travelogue_details***/
export const update_travelogue_details = async (event) => {
    if (await check_empty_fields(event)) {
        let checkpoststatus = {
            TableName: "tl_travelogues",
            KeyConditionExpression: "travelogue_id = :travelogue_id",
            FilterExpression: "post_status = :post_status",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":post_status": "OPEN"
            }
        };
        let statusofpost = await query_dynamo(checkpoststatus);
        if (statusofpost.Count > 0) {
            let updatedetails = {
                TableName: "tl_travelogues",
                Key: {
                    travelogue_id: statusofpost.Items[0].travelogue_id
                },
                UpdateExpression: 'SET travelogue_name = :travelogue_name, travelogue_description = :travelogue_description',
                ExpressionAttributeValues: {
                    ':travelogue_name': event.travelogue_name,
                    ':travelogue_description': event.travelogue_description
                }
            };
            try {
                await update_dynamo(updatedetails);
                let invocation_params = {
                    command: "send_to_topic",
                    topic: statusofpost.Items[0].travelogue_id,
                    title: "Travelog",
                    message: "Travelog " + statusofpost.Items[0].travelogue_name + " has been updated"
                };
                await invokeLambda(invocation_params, "Travelogue_notification", "Event");
                return { Status: "SUCCESS", Message: "Travelog details updated successfully!!!" };
            }
            catch (error) {
                return { Status: "ERROR", Message: "Failed to update Travelog details" };
            }
        }
        else {
            return { Status: "ERROR", Message: "Travelog not found" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Fields Occurred" };
    }
};

/***list_cotravellers***/
export const list_cotravellers = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserAlreadyExist = {
            TableName: "tl_app_user",
            IndexName: "phone_number-user_status-index",
            KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
                ":user_status": "ACTIVE"
            }
        };
        let UserDetails = await query_dynamo(checkUserAlreadyExist);
        if (UserDetails.Count > 0) {
            let getCotravellerDetails = {
                TableName: "tl_users_access",
                IndexName: "user_status-account_type-index",
                KeyConditionExpression: "user_status = :user_status and account_type = :account_type",
                ExpressionAttributeValues: {
                    ":user_status": "ACTIVE",
                    ":account_type": "COTRAVELLER",
                    ":travelogue_id": event.travelogue_id
                },
                FilterExpression: "travelogue_id = :travelogue_id",
                ScanIndexForward: false,
                // Limit: 100
            };
            let cotravellerDetails = await get_query_all_data(getCotravellerDetails);
            if (cotravellerDetails.Count > 0) {
                return { Status: "SUCCESS", Data: cotravellerDetails.Items };
            }
            else {
                return { Status: "ERROR", Message: "Co-Curator Not Found!!!" };
            }
        }
        else {
            return { Status: "ERROR", Message: " Travelog Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***delete_cotraveller_viewer***/
export const delete_cotraveller_viewer = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserAlreadyExist = {
            TableName: "tl_users_access",
            IndexName: "phone_number-user_status-index",
            KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
                ":user_status": "ACTIVE",
                ":travelogue_id": event.travelogue_id
            },
            FilterExpression: "travelogue_id = :travelogue_id"
        };
        let UserDetails = await query_dynamo(checkUserAlreadyExist);
        if (UserDetails.Count > 0) {
            let updatedetails = {
                TableName: "tl_users_access",
                Key: {
                    mapping_id: UserDetails.Items[0].mapping_id
                },
                UpdateExpression: 'SET user_status = :user_status',
                ExpressionAttributeValues: {
                    ':user_status': "DEACTIVATED"
                }
            };
            try {
                await update_dynamo(updatedetails);
                return { Status: "SUCCESS", Message: "user deactivated successfully!!!" };
            }
            catch (error) {
                return { Status: "ERROR", Message: "Failed to deactivate user" };
            }
        }
        else {
            return { Status: "ERROR", Message: "user not found" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Fields Occurred" };
    }
};

/***delete_account***/

export const delete_account = async (event) => {
    if (await check_empty_fields(event)) {
        let checkGlobalUserExist = {
            TableName: "tl_app_user",
            IndexName: "phone_number-index",
            KeyConditionExpression: "phone_number = :phone_number ",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
            }
        };
        let globaluserDetails = await query_dynamo(checkGlobalUserExist);
        if (globaluserDetails.Count > 0) {
            let checkMappingUserExist = {
                TableName: "tl_users_access",
                IndexName: "phone_number-index",
                KeyConditionExpression: "phone_number = :phone_number",
                ExpressionAttributeValues: {
                    ":phone_number": globaluserDetails.Items[0].phone_number,
                }
            };
            let mappinguserDetails = await query_dynamo(checkMappingUserExist);
            if (mappinguserDetails.Count > 0) {
                await delete_dynamo({
                    TableName: "tl_app_user",
                    Key: {
                        user_id: globaluserDetails.Items[0].user_id
                    },
                });

                // Delete from tl_users_access table
                for (let s = 0; s < mappinguserDetails.Items.length; s++) {
                    let delete_mapping = {
                        TableName: "tl_users_access",
                        Key: {
                            mapping_id: mappinguserDetails.Items[s].mapping_id
                        }
                    };
                    await delete_dynamo(delete_mapping);
                }

                // Delete from tl_travelogues table
                let checkTravelogueExist = {
                    TableName: "tl_travelogues",
                    IndexName: "phone_number-index",
                    KeyConditionExpression: "phone_number = :phone_number",
                    ExpressionAttributeValues: {
                        ":phone_number": event.phone_number
                    }
                };
                let travelogueDetails = await query_dynamo(checkTravelogueExist);
                if (travelogueDetails.Count > 0) {
                    for (let t = 0; t < travelogueDetails.Items.length; t++) {
                        let delete_travelogue = {
                            TableName: "tl_travelogues",
                            Key: {
                                travelogue_id: travelogueDetails.Items[t].travelogue_id
                            }
                        };
                        await delete_dynamo(delete_travelogue);

                        // Delete from tl_pov_table
                        let checkPovExist = {
                            TableName: "tl_pov_table",
                            IndexName: "travelogue_id-index",
                            KeyConditionExpression: "travelogue_id = :travelogue_id",
                            ExpressionAttributeValues: {
                                ":travelogue_id": travelogueDetails.Items[t].travelogue_id
                            }
                        };
                        let povDetails = await query_dynamo(checkPovExist);
                        if (povDetails.Count > 0) {
                            for (let p = 0; p < povDetails.Items.length; p++) {
                                let delete_pov = {
                                    TableName: "tl_pov_table",
                                    Key: {
                                        pov_id: povDetails.Items[p].pov_id
                                    }
                                };
                                await delete_dynamo(delete_pov);
                            }
                        }

                        // Delete from tl_post_table
                        let checkPostExist = {
                            TableName: "tl_post_table",
                            IndexName: "travelogue_id-index",
                            KeyConditionExpression: "travelogue_id = :travelogue_id",
                            ExpressionAttributeValues: {
                                ":travelogue_id": travelogueDetails.Items[t].travelogue_id
                            }
                        };
                        let postDetails = await query_dynamo(checkPostExist);
                        if (postDetails.Count > 0) {
                            for (let p = 0; p < postDetails.Items.length; p++) {
                                let delete_post = {
                                    TableName: "tl_post_table",
                                    Key: {
                                        post_id: postDetails.Items[p].post_id
                                    }
                                };
                                await delete_dynamo(delete_post);
                            }
                        }
                    }
                }

                return { Status: "SUCCESS", Message: "User deactivated successfully!!!" };
            }
            else {
                return { Status: "ERROR", Message: "Global user not found" };
            }
        }
        else {
            return { Status: "ERROR", Message: "Mapping user not found" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Fields Occurred" };
    }
};








/***list_viewers***/
export const list_viewers = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserAlreadyExist = {
            TableName: "tl_app_user",
            IndexName: "phone_number-user_status-index",
            KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
                ":user_status": "ACTIVE"
            }
        };
        let UserDetails = await query_dynamo(checkUserAlreadyExist);
        if (UserDetails.Count > 0) {
            let getviewerDetails = {
                TableName: "tl_users_access",
                IndexName: "user_status-account_type-index",
                KeyConditionExpression: "user_status = :user_status and account_type = :account_type",
                ExpressionAttributeValues: {
                    ":user_status": "ACTIVE",
                    ":account_type": "VIEWER",
                    ":travelogue_id": event.travelogue_id
                },
                FilterExpression: "travelogue_id = :travelogue_id",
                ScanIndexForward: false,
                // Limit: 100
            };
            let viewerDetails = await get_query_all_data(getviewerDetails);
            if (viewerDetails.Count > 0) {
                return { Status: "SUCCESS", Data: viewerDetails.Items };
            }
            else {
                return { Status: "ERROR", Message: "Viewer Not Found!!!" };
            }
        }
        else {
            return { Status: "ERROR", Message: " Travelog Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***pov_creation***/
export const pov_creation = async (event) => {
    if (await check_empty_fields(event)) {
        let checkaccounttype = {
            TableName: "tl_users_access",
            IndexName: "travelogue_id-phone_number-index",
            KeyConditionExpression: "travelogue_id = :travelogue_id and phone_number = :phone_number",
            FilterExpression: "account_type <> :account_type",

            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":phone_number": event.phone_number,
                ":account_type": "VIEWER"

            }
        };
        let accounttype = await query_dynamo(checkaccounttype);
        if (accounttype.Count > 0) {
            let checkpoststatus = {
                TableName: "tl_travelogues",
                IndexName: "travelogue_id-post_status-index",
                KeyConditionExpression: "travelogue_id = :travelogue_id and post_status = :post_status",
                ExpressionAttributeValues: {
                    ":travelogue_id": accounttype.Items[0].travelogue_id,
                    ":post_status": "OPEN",
                    ":travelogue_status": "ACTIVE"
                },
                FilterExpression: "travelogue_status = :travelogue_status"
            };
            let statusofpost = await query_dynamo(checkpoststatus);
            if (statusofpost.Count > 0) {
                let createpov = {
                    TableName: "tl_pov_table",
                    Item: {
                        pov_id: event.pov_id,
                        travelogue_id: statusofpost.Items[0].travelogue_id,
                        pov_name: event.pov_name,
                        pov_created_on: Math.floor(new Date().getTime() / 1000),
                        pov_image_url: event.pov_image_url,
                        pov_latitude: event.pov_latitude,
                        pov_longitude: event.pov_longitude,
                        pov_notes: event.pov_notes || "",
                        pov_created_by: accounttype.Items[0].user_name,
                        pov_status: "ACTIVE",
                        post_url: []
                    }
                };
                let POVinsert = await insert_into_dynamo(createpov);
                if (POVinsert == "SUCCESS") {
                    let updateSubCount = {
                        TableName: "tl_travelogues",
                        Key: {
                            travelogue_id: statusofpost.Items[0].travelogue_id
                        },
                        UpdateExpression: 'Add pov_count :pov_count',
                        ExpressionAttributeValues: {
                            ':pov_count': 1,
                        }
                    };
                    await update_dynamo(updateSubCount);
                    let invocation_params = {
                        command: "send_to_topic",
                        topic: statusofpost.Items[0].travelogue_id,
                        title: "Travelog",
                        message: "POV " + event.pov_name + "has been added to " + statusofpost.Items[0].travelogue_name + " Travelog"
                    };
                    await invokeLambda(invocation_params, "Travelogue_notification", "Event");

                    return { Status: "SUCCESS", Message: "POV created successfully !!!" };
                }

                else {
                    return { Status: "ERROR", Message: "failed create POV" };
                }
            }
            else {
                return { Status: "ERROR", Message: "Travelog has been closed" };
            }
        }
        else {
            return { Status: "ERROR", Message: "access denied as you are a viewer." };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }

};

/***edit_pov***/
export const edit_pov = async (event) => {
    if (await check_empty_fields(event)) {
        let checkaccounttype = {
            TableName: "tl_users_access",
            IndexName: "travelogue_id-phone_number-index",
            KeyConditionExpression: "travelogue_id = :travelogue_id and phone_number = :phone_number",
            FilterExpression: "account_type <> :account_type",

            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":phone_number": event.phone_number,
                ":account_type": "VIEWER"
            }
        };
        let accounttype = await query_dynamo(checkaccounttype);
        if (accounttype.Count > 0) {
            let checkpoststatus = {
                TableName: "tl_travelogues",
                KeyConditionExpression: "travelogue_id = :travelogue_id",
                ExpressionAttributeValues: {
                    ":travelogue_id": accounttype.Items[0].travelogue_id,
                    ":travelogue_status": "ACTIVE"
                },
                FilterExpression: "travelogue_status = :travelogue_status"
            };
            let statusofpost = await query_dynamo(checkpoststatus);
            if (statusofpost.Count > 0) {
                let checkpovexists = {
                    TableName: "tl_pov_table",
                    KeyConditionExpression: "pov_id = :pov_id",
                    ExpressionAttributeValues: {
                        ":pov_id": event.pov_id,
                        ":pov_status": "ACTIVE"
                    },
                    FilterExpression: "pov_status = :pov_status"
                };
                let statusofpov = await query_dynamo(checkpovexists);
                if (statusofpov.Count > 0) {
                    let updateStatus = {
                        TableName: "tl_pov_table",
                        Key: {
                            pov_id: statusofpov.Items[0].pov_id
                        },
                        UpdateExpression: 'SET pov_name = :pov_name , pov_latitude = :pov_latitude , pov_longitude = :pov_longitude , pov_notes = :pov_notes',
                        ExpressionAttributeValues: {
                            ':pov_name': event.pov_name,
                            ':pov_latitude': event.pov_latitude || "",
                            ':pov_longitude': event.pov_longitude || "",
                            ':pov_notes': event.pov_notes || ""
                        }
                    };
                    let updateStatusResponse = await update_dynamo(updateStatus);
                    if (updateStatusResponse == "SUCCESS") {
                        return { Status: "SUCCESS", Message: "pov Edit successfull !!!" };
                    }

                    else {
                        return { Status: "ERROR", Message: "failed to edit pov" };
                    }
                }
                else {
                    return { Status: "ERROR", Message: "Travelog has been closed" };
                }
            }
            else {
                return { Status: "ERROR", Message: "POV doesn't exist." };
            }
        }
        else {
            return { Status: "ERROR", Message: "access denied as you are a viewer." };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***list_pov***/
export const list_pov = async (event) => {
    if (event) {
        let gettravDetails = {
            TableName: "tl_travelogues",
            KeyConditionExpression: "travelogue_id = :travelogue_id",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":travelogue_status": "ACTIVE"

            },
            FilterExpression: "travelogue_status = :travelogue_status"
        };
        let traveloguestexist = await query_dynamo(gettravDetails);
        if (traveloguestexist.Count > 0) {
            let getpovDetails = {
                TableName: "tl_pov_table",
                IndexName: "travelogue_id-index",
                KeyConditionExpression: "travelogue_id = :travelogue_id",
                ExpressionAttributeValues: {
                    ":travelogue_id": traveloguestexist.Items[0].travelogue_id,
                    ":pov_status": "ACTIVE"
                },
                FilterExpression: "pov_status = :pov_status"
            };
            let povDetails = await get_query_all_data(getpovDetails);
            if (povDetails.Count > 0) {
                return { Status: "SUCCESS", Data: povDetails.Items };
            }
            else {
                return { Status: "ERROR", Message: "POVs Not Found!!" };
            }
        }
        else {
            return { Status: "ERROR", Message: "Travelogs Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};

/***delete_pov***/
export const delete_pov = async (event) => {
    if (event) {
        let gettravDetails = {
            TableName: "tl_travelogues",
            KeyConditionExpression: "travelogue_id = :travelogue_id",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":travelogue_status": "ACTIVE"
            },
            FilterExpression: "travelogue_status = :travelogue_status"
        };
        let traveloguestexist = await query_dynamo(gettravDetails);
        if (traveloguestexist.Count > 0) {
            let getpovDetails = {
                TableName: "tl_pov_table",
                KeyConditionExpression: "pov_id = :pov_id",
                ExpressionAttributeValues: {
                    ":pov_id": event.pov_id,
                    ":travelogue_id": traveloguestexist.Items[0].travelogue_id,
                },
                FilterExpression: "travelogue_id = :travelogue_id"
            };
            let povDetails = await query_dynamo(getpovDetails);
            if (povDetails.Count > 0) {
                update_dynamo({
                    TableName: "tl_pov_table",
                    Key: {
                        pov_id: povDetails.Items[0].pov_id
                    },
                    UpdateExpression: 'SET pov_status = :pov_status',
                    ExpressionAttributeValues: {
                        ':pov_status': "DEACTIVATED"
                    }
                });
                let updatepovcount = {
                    TableName: "tl_travelogues",
                    Key: {
                        travelogue_id: traveloguestexist.Items[0].travelogue_id
                    },
                    UpdateExpression: 'ADD pov_count  :pov_count',
                    ExpressionAttributeValues: {
                        ':pov_count': -1,
                    }
                };
                let updateStatusResponse = await update_dynamo(updatepovcount);
                let invocation_params = {
                    command: "send_to_topic",
                    topic: traveloguestexist.Items[0].travelogue_id,
                    title: "Travelog",
                    message: "POV Deleted Successfully"
                };
                await invokeLambda(invocation_params, "Travelogue_notification", "Event");
                if (updateStatusResponse == "SUCCESS") {
                    return { Status: "SUCCESS", Message: "POVs Deleted Successfully!!" };
                }
            }
            else {
                return { Status: "ERROR", Message: "POVs Not Found!!" };
            }
        }
        else {
            return { Status: "ERROR", Message: "Travelogs Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};

/***post_creation***/
export const post_creation = async (event) => {
    if (await check_empty_fields(event)) {
        let checkaccounttype = {
            TableName: "tl_users_access",
            IndexName: "travelogue_id-phone_number-index",
            KeyConditionExpression: "travelogue_id = :travelogue_id and phone_number = :phone_number",
            FilterExpression: "account_type <> :account_type",

            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":phone_number": event.phone_number,
                ":account_type": "VIEWER"
            }
        };
        let accounttype = await query_dynamo(checkaccounttype);
        if (accounttype.Count > 0) {
            let checkpovexists = {
                TableName: "tl_pov_table",
                KeyConditionExpression: "pov_id = :pov_id",
                ExpressionAttributeValues: {
                    ":pov_id": event.pov_id,
                },
            };
            let statusofpov = await query_dynamo(checkpovexists);
            if (statusofpov.Count > 0) {
                let createpost = {
                    TableName: "tl_post_table",
                    Item: {
                        post_id: uuidv4(),
                        pov_id: statusofpov.Items[0].pov_id,
                        post_type: event.post_type,
                        post_created_on: Math.floor(new Date().getTime() / 1000),
                        post_caption: event.post_caption,
                        post_url: event.post_url,
                        media_status: "ACTIVE",
                        post_created_by: accounttype.Items[0].user_name,
                        travelogue_id: accounttype.Items[0].travelogue_id
                    }
                };
                let postinsert = await insert_into_dynamo(createpost);
                if (postinsert == "SUCCESS") {
                    let updatePovItem = {
                        TableName: "tl_pov_table",
                        Key: {
                            pov_id: statusofpov.Items[0].pov_id
                        },
                        UpdateExpression: 'SET post_url = list_append(post_url, :post_url)',
                        ExpressionAttributeValues: {
                            ':post_url': [event.post_url],
                        }
                    };
                    await update_dynamo(updatePovItem);
                    await update_dynamo({
                        TableName: "tl_pov_table",
                        Key: {
                            pov_id: statusofpov.Items[0].pov_id
                        },
                        UpdateExpression: 'Add post_count :post_count',
                        ExpressionAttributeValues: {
                            ':post_count': 1,
                        }
                    });
                    let updateSubCount = {
                        TableName: "tl_travelogues",
                        Key: {
                            travelogue_id: event.travelogue_id
                        },
                        UpdateExpression: 'Add post_count :post_count',
                        ExpressionAttributeValues: {
                            ':post_count': 1,
                        }
                    };
                    await update_dynamo(updateSubCount);
                    return { Status: "SUCCESS", Message: "Media created successfully !!!" };
                }
                else {
                    return { Status: "ERROR", Message: "failed to create Media" };
                }
            }
            else {
                return { Status: "ERROR", Message: "No Point Of View" };
            }
        }
        else {
            return { Status: "ERROR", Message: "access denied as you are a viewer." };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};

/***list_post***/
export const list_post = async (event) => {
    if (event) {
        let gettravDetails = {
            TableName: "tl_travelogues",
            KeyConditionExpression: "travelogue_id = :travelogue_id",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":travelogue_status": "ACTIVE"

            },
            FilterExpression: "travelogue_status = :travelogue_status"
        };
        let traveloguestexist = await query_dynamo(gettravDetails);
        if (traveloguestexist.Count > 0) {
            let getpovDetails = {
                TableName: "tl_pov_table",
                KeyConditionExpression: "pov_id = :pov_id",
                ExpressionAttributeValues: {
                    ":pov_id": event.pov_id,
                    ":pov_status": "ACTIVE"
                },
                FilterExpression: "pov_status = :pov_status"
            };
            let povtexist = await query_dynamo(getpovDetails);
            if (povtexist.Count > 0) {
                let getpostDetails = {
                    TableName: "tl_post_table",
                    IndexName: "pov_id-media_status-index",
                    KeyConditionExpression: "pov_id = :pov_id  and media_status = :media_status",
                    ExpressionAttributeValues: {
                        ":pov_id": povtexist.Items[0].pov_id,
                        ":media_status": "ACTIVE"

                    },
                };
                let postDetails = await get_query_all_data(getpostDetails);
                if (postDetails.Count > 0) {
                    return { Status: "SUCCESS", Data: postDetails.Items, Message: "Media listed successfully" };
                }
                else {
                    return { Status: "ERROR", Message: "Media Not Found!!" };
                }
            }
            else {
                return { Status: "ERROR", Message: "POV Not Found!!" };
            }
        }
        else {
            return { Status: "ERROR", Message: "Travelog Not Found!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};

/***list_packages***/
export const list_packages = async (event) => {
    if (await check_empty_fields(event)) {
        let getpackageDetails = {
            TableName: "tl_package",
            IndexName: "package_status-index",
            KeyConditionExpression: " package_status = :package_status",
            ExpressionAttributeValues: {
                ":package_status": "ACTIVE"
            },
            ScanIndexForward: false,
            // Limit: 100
        };
        let packageDetails = await query_dynamo(getpackageDetails);
        if (packageDetails.Count > 0) {
            return { Status: "SUCCESS", Data: packageDetails.Items };
        }
        else {
            return { Status: "ERROR", Message: "package Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***list_users***/
export const list_users = async (event) => {
    if (await check_empty_fields(event)) {
        let getUserDetails = {
            TableName: "tl_app_user",
            IndexName: "user_status-index",
            KeyConditionExpression: "user_status = :user_status",
            ExpressionAttributeValues: {
                ":user_status": "ACTIVE",
            },
            ScanIndexForward: false,
            Limit: 100
        };
        let userDetails = await query_dynamo(getUserDetails);
        if (userDetails.Count > 0) {
            return { Status: "SUCCESS", Data: userDetails.Items };
        }
        else {
            return { Status: "ERROR", Message: "users Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***create_travelogue_subscription***/
export const create_travelogue_subscription = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserExist = {
            TableName: "tl_users_access",
            IndexName: "phone_number-user_status-index",
            KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
                ":user_status": "ACTIVE",
                ":travelogue_id": event.travelogue_id
            },
            FilterExpression: "travelogue_id = :travelogue_id"
        };
        let UserDetails = await query_dynamo(checkUserExist);
        if (UserDetails.Count > 0) {
            let checksubscription = {
                TableName: "tl_subscription_table",
                IndexName: "travelogue_id-travelogue_subscription_status-index",
                KeyConditionExpression: "travelogue_id = :travelogue_id and travelogue_subscription_status = :travelogue_subscription_status",
                ExpressionAttributeValues: {
                    ":travelogue_id": event.travelogue_id,
                    ":travelogue_subscription_status": "ACTIVE",
                },
            };
            let subscriptionDetails = await query_dynamo(checksubscription);
            if (subscriptionDetails.Count === 0) {
                let createSubscription = {
                    TableName: "tl_subscription_table",
                    Item: {
                        subscription_id: uuidv4(),
                        travelogue_id: UserDetails.Items[0].travelogue_id,
                        transaction_id: event.transaction_id,
                        transaction_amount: "1$",
                        subscriber_phone_number: UserDetails.Items[0].phone_number,
                        user_name: UserDetails.Items[0].user_name,
                        sub_start_date: Math.floor(new Date().getTime() / 1000),
                        sub_end_date: Math.floor(new Date().getTime() / 1000) + Math.floor(3.154e+10 / 1000),
                        travelogue_subscription_status: "ACTIVE"
                    }
                };
                let updateSubStatus = {
                    TableName: "tl_travelogues",
                    Key: {
                        travelogue_id: UserDetails.Items[0].travelogue_id
                    },
                    UpdateExpression: 'set travelogue_subscription_status = :travelogue_subscription_status',
                    ExpressionAttributeValues: {
                        ':travelogue_subscription_status': "PREMIUM",
                    }
                };
                let subscriptionResponse = await insert_into_dynamo(createSubscription);
                let invocation_params = {
                    command: "send_to_topic",
                    topic: UserDetails.Items[0].travelogue_id,
                    title: "Travelog",
                    message: "A POV has been added"
                };
                await invokeLambda(invocation_params, "Travelogue_notification", "Event");
                if (subscriptionResponse === "SUCCESS") {
                    await update_dynamo(updateSubStatus);
                    return { Status: "SUCCESS", Message: "Subscription Created Successfully!!" };
                }

                else {
                    return { Status: "ERROR", Message: "Some error occurred during the creation of subscription" };
                }
            }
            else {
                return { Status: "ERROR", Message: "You are already a PREMIUM Member." };
            }
        }
        else {
            return { Status: "ERROR", Message: "User not found or is not active" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Fields Occurred" };
    }
};

/***make_travelogue_public***/
export const make_travelogue_public = async (event) => {
    if (await check_empty_fields(event)) {
        let checkpoststatus = {
            TableName: "tl_travelogues",
            KeyConditionExpression: "travelogue_id = :travelogue_id",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id
            },
        };
        let statusofpost = await query_dynamo(checkpoststatus);
        if (statusofpost.Count > 0) {
            let updateStatus = {
                TableName: "tl_travelogues",
                Key: {
                    travelogue_id: statusofpost.Items[0].travelogue_id
                },
                UpdateExpression: 'SET travelogue_availability = :travelogue_availability',
                ExpressionAttributeValues: {
                    ':travelogue_availability': "PUBLIC",
                }
            };
            await update_dynamo(updateStatus);
            return { Status: "SUCCESS", Message: "Travelogue set to public showcase!" };
        }
        else {
            return { Status: "ERROR", Message: "Failed to showcase" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};


/***list_public_travelogues***/
export const list_public_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let getpublicDetails = {
            TableName: "tl_travelogues",
            IndexName: "travelogue_availability-travelogue_status-index",
            KeyConditionExpression: " travelogue_availability = :travelogue_availability and travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":travelogue_availability": "PUBLIC",
                ":travelogue_status": "ACTIVE",
                ":account_type": "AGENT"
            },
            FilterExpression: "account_type <> :account_type"
        };
        let publicDetails = await get_query_all_data(getpublicDetails);
        if (publicDetails.Count > 0) {
            return { Status: "SUCCESS", Data: publicDetails.Items };
        }
        else {
            return { Status: "ERROR", Message: "package Not Found!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***add_my_favorite_travelogues***/
export const add_my_favorite_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let checkaccounttype = {
            TableName: "tl_app_user",
            IndexName: "phone_number-user_status-index",
            KeyConditionExpression: "phone_number = :phone_number and user_status = :user_status",
            ExpressionAttributeValues: {
                ":phone_number": event.phone_number,
                ":user_status": "ACTIVE",
            }
        };
        let accounttype = await query_dynamo(checkaccounttype);
        if (accounttype.Count > 0) {
            let getpublicDetails = {
                TableName: "tl_travelogues",
                KeyConditionExpression: "travelogue_id = :travelogue_id",
                FilterExpression: "travelogue_availability = :travelogue_availability and travelogue_status = :travelogue_status and Approval_status = :Approval_status",
                ExpressionAttributeValues: {
                    ":travelogue_id": event.travelogue_id,
                    ":travelogue_availability": "APPROVED",
                    ":travelogue_status": "ACTIVE",
                    ":Approval_status": "APPROVED"
                },
            };
            let publicDetails = await get_query_all_data(getpublicDetails);
            if (publicDetails.Count > 0) {
                let updateStatus = {
                    TableName: "tl_app_user",
                    Key: {
                        user_id: accounttype.Items[0].user_id
                    },
                    UpdateExpression: "SET My_Favorite_travelogs = list_append(if_not_exists(My_Favorite_travelogs, :emptyList), :newData)",
                    ExpressionAttributeValues: {
                        ":emptyList": [],
                        ":newData": [{
                            ":travelogue_id": publicDetails.Items[0].travelogue_id,
                            ':Favorite_status': "FAVORITE",
                        }]
                    }
                };
                await update_dynamo(updateStatus);
                return { Status: "SUCCESS", Message: "Travelog has been added to Favorite list", Data: updateStatus.Items };
            }
            else {
                return { Status: "ERROR", Message: "couldn't add to favorites!" };
            }
        }
        else {
            return { Status: "ERROR", Message: "user Doesnt Exist" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }

};



/***display_my_favorite_travelogues***/
export const display_my_favorite_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let getpublicDetails = {
            TableName: "tl_app_user",
            KeyConditionExpression: " travelogue_id = :travelogue_id",
            ExpressionAttributeValues: {
                ":travelogue_status": "ACTIVE",
                ":Favorite_status": "FAVORITE"
            },
            FilterExpression: "Favorite_status = :Favorite_status and travelogue_status = : travelogue_status"
        };
        let publicDetails = await get_query_all_data(getpublicDetails);
        if (publicDetails.Count > 0) {
            return { Status: "SUCCESS", Data: publicDetails.Items };
        }
        else {
            return { Status: "ERROR", Message: "couldn't display  FEATURED!" };
        }
    }
};

/***display_featured_travelogues***/
export const display_featured_travelogues = async (event) => {
    if (await check_empty_fields(event)) {
        let getpublicDetails = {
            TableName: "tl_travelogues",
            IndexName: "travelogue_availability-travelogue_status-index",
            KeyConditionExpression: "travelogue_availability = :travelogue_availability and travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":travelogue_availability": "APPROVED",
                ":travelogue_status": "ACTIVE",
                ":Approval_status": "APPROVED",
                ":travelogue_Departure_country": event.travelogue_Departure_country
            }
        };

        // If travelogue_Departure_state is provided, add it to the filter expression
        if (event.travelogue_Departure_state) {
            getpublicDetails.ExpressionAttributeValues[":travelogue_Departure_state"] = event.travelogue_Departure_state;
            getpublicDetails.FilterExpression = "Approval_status = :Approval_status and travelogue_Departure_state = :travelogue_Departure_state and travelogue_Departure_country = :travelogue_Departure_country";
        }
        else {
            // If travelogue_Departure_state is not provided, fetch all travelogues associated with India
            getpublicDetails.FilterExpression = "Approval_status = :Approval_status and travelogue_Departure_country = :travelogue_Departure_country";
        }

        let publicDetails = await get_query_all_data(getpublicDetails);
        if (publicDetails.Count > 0) {
            return { Status: "SUCCESS", Data: publicDetails.Items };
        }
        else {
            return { Status: "ERROR", Message: "Couldn't display FEATURED!" };
        }
    }
};





/***cancel_subscription***/
export const cancel_subscription = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserExist = {
            TableName: "tl_travelogues",
            IndexName: "travelogue_id-post_status-index",
            KeyConditionExpression: "travelogue_id = :travelogue_id and post_status = :post_status",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":post_status": "OPEN",
                ":travelogue_subscription_status": "PREMIUM",
            },
            FilterExpression: "travelogue_subscription_status = :travelogue_subscription_status",
        };
        let UserDetails = await query_dynamo(checkUserExist);
        if (UserDetails.Count > 0) {
            let checksubscription = {
                TableName: "tl_subscription_table",
                IndexName: "travelogue_id-travelogue_subscription_status-index",
                KeyConditionExpression: "travelogue_id = :travelogue_id and travelogue_subscription_status = :travelogue_subscription_status",
                ExpressionAttributeValues: {
                    ":travelogue_id": UserDetails.Items[0].travelogue_id,
                    ":travelogue_subscription_status": "ACTIVE"

                },
            };
            let subscriptionDetails = await query_dynamo(checksubscription);
            if (subscriptionDetails.Count > 0) {
                let updateSub = {
                    TableName: "tl_subscription_table",
                    Key: {
                        subscription_id: subscriptionDetails.Items[0].subscription_id
                    },
                    UpdateExpression: 'SET travelogue_subscription_status = :travelogue_subscription_status',
                    ExpressionAttributeValues: {
                        ':travelogue_subscription_status': "DEACTIVATED",
                    }
                };
                let updateuser = {
                    TableName: "tl_travelogues",
                    Key: {
                        travelogue_id: UserDetails.Items[0].travelogue_id
                    },
                    UpdateExpression: 'SET travelogue_subscription_status = :travelogue_subscription_status',
                    ExpressionAttributeValues: {
                        ':travelogue_subscription_status': "FREE",
                    }
                };
                await update_dynamo(updateSub);
                await update_dynamo(updateuser);

                return { Status: "SUCCESS", Message: "Subscription canceled successfully" };
            }
            else {
                return { Status: "ERROR", Message: "Could'nt cancel the Subscription as you don't have any active Subscriptions." };
            }
        }
        else {
            return { Status: "ERROR", Message: "No Subscriptions found for the User" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***delete_post***/
export const delete_post = async (event) => {
    if (event) {
        let gettravDetails = {
            TableName: "tl_travelogues",
            KeyConditionExpression: "travelogue_id = :travelogue_id",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id
            }
        };
        let traveloguestexist = await query_dynamo(gettravDetails);
        if (traveloguestexist.Count > 0 && traveloguestexist.Items[0].travelogue_status === "ACTIVE") {
            let getPostDetails = {
                TableName: "tl_post_table",
                IndexName: "pov_id-media_status-index",
                KeyConditionExpression: "pov_id = :pov_id and media_status = :media_status",
                ExpressionAttributeValues: {
                    ":pov_id": event.pov_id,
                    ":media_status": "ACTIVE",
                    ":post_id": event.post_id,
                    ":travelogue_id": traveloguestexist.Items[0].travelogue_id
                },
                FilterExpression: "travelogue_id = :travelogue_id and post_id = :post_id"
            };
            let postDetails = await query_dynamo(getPostDetails);
            if (postDetails.Count > 0) {
                update_dynamo({
                    TableName: "tl_post_table",
                    Key: {
                        post_id: postDetails.Items[0].post_id
                    },
                    UpdateExpression: 'SET media_status = :media_status',
                    ExpressionAttributeValues: {
                        ':media_status': "DEACTIVATED",
                    }
                });
                let updatepovcount = {
                    TableName: "tl_travelogues",
                    Key: {
                        travelogue_id: traveloguestexist.Items[0].travelogue_id
                    },
                    UpdateExpression: 'ADD post_count :post_count',
                    ExpressionAttributeValues: {
                        ':post_count': -1,
                    }
                };
                let updateStatusResponse = await update_dynamo(updatepovcount);
                if (updateStatusResponse === "SUCCESS") {
                    return { Status: "SUCCESS", Message: "Media Deleted Successfully" };
                }
                else {
                    return { Status: "ERROR", Message: "Couldn't Delete Media!" };
                }
            }
            else {
                return { Status: "ERROR", Message: "Post Not Found" };
            }
        }
        else {
            return { Status: "ERROR", Message: "Travelog Not Found or Not Active" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occurred" };
    }
};

/***list_my_subscriptions***/
export const list_my_subscriptions = async (event) => {
    if (await check_empty_fields(event)) {
        let getSubscriptionDetails = {
            TableName: "tl_subscription_table",
            IndexName: "subscriber_phone_number-travelogue_subscription_status-index",
            KeyConditionExpression: " subscriber_phone_number = :subscriber_phone_number and travelogue_subscription_status = :travelogue_subscription_status",
            ExpressionAttributeValues: {
                ":subscriber_phone_number": event.subscriber_phone_number,
                ":travelogue_subscription_status": "ACTIVE"
            },
        };
        let subsDetails = await get_query_all_data(getSubscriptionDetails);
        if (subsDetails.Count > 0) {
            return { Status: "SUCCESS", Data: subsDetails.Items };
        }
        else {
            return { Status: "ERROR", Message: "No Subscriptions Found For the  User!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};

/***get_travelog_subscriptions***/
export const get_travelog_subscriptions = async (event) => {
    if (await check_empty_fields(event)) {
        let getSubscriptionDetails = {
            TableName: "tl_subscription_table",
            IndexName: "travelogue_id-travelogue_subscription_status-index",
            KeyConditionExpression: " travelogue_id = :travelogue_id and travelogue_subscription_status = :travelogue_subscription_status",
            ExpressionAttributeValues: {
                ":travelogue_id": event.travelogue_id,
                ":travelogue_subscription_status": "ACTIVE",
            },
        };
        let subsDetails = await get_query_all_data(getSubscriptionDetails);
        if (subsDetails.Count > 0) {
            return { Status: "SUCCESS", Data: subsDetails.Items };
        }
        else {
            return { Status: "ERROR", Message: "No Subscriptions Found For the  User!!!" };
        }
    }
    else {
        return { Status: "ERROR", Message: "Empty Field Occured" };
    }
};


/***get_agent***/
export const get_agent = async (event) => {
    if (await check_empty_fields(event)) {
        let checkUserExist = {
            TableName: "tl_agent",
            IndexName: "agent_email-agent_status-index",
            KeyConditionExpression: "agent_email = :agent_email and agent_status = :agent_status",
            ExpressionAttributeValues: {
                ":agent_email": event.agent_email,
                ":agent_status": "ACTIVE"
            }
        };
        let UserDetails = await query_dynamo(checkUserExist);
        if (UserDetails.Count > 0) {
            return { Status: "SUCCESS", Data: UserDetails.Items };
        }
        else {
            return { Status: "ERROR", Message: "User Not Found!!!" };
        }
    }
};


/***travelogS3URL***/
export const travelogS3URL = async (event) => {
    try {
        let REGION = process.env.REGION;
        let BUCKET = process.env.BUCKET;
        let KEY = event.key;

        const client = new S3Client({ region: REGION });
        const command = new PutObjectCommand({ Bucket: BUCKET, Key: KEY });

        const presignedUrl = await getSignedUrl(client, command, { expiresIn: 36000 });
        console.log("Presigned URL:", presignedUrl);

        return {
            status: "Success",
            message: presignedUrl
        };
    }
    catch (err) {
        console.error(err);
        throw new Error(err);
    }
};



/***travelogS3URL_for_download***/
async function travelogS3URL_for_download(event) {
    try {
        let REGION = process.env.REGION;
        let BUCKET = process.env.BUCKET;
        let KEY = event.key;

        const client = new S3Client({ region: REGION });
        const command = new GetObjectCommand({ Bucket: BUCKET, Key: KEY });

        const presignedUrl = await getSignedUrl(client, command, { expiresIn: 36000 });
        console.log("Presigned URL:", presignedUrl);

        return {
            status: "Success",
            message: presignedUrl
        };
    }
    catch (err) {
        console.error(err);
        throw new Error(err);
    }
}


async function list_agent_locations(event) {
    try {
        console.log('Fetching agent locations...');

        const params = {
            TableName: 'tl_travelogues',
            ProjectionExpression: '#s', // Use alias for state
            ExpressionAttributeNames: {
                '#s': 'state' // Define alias for state
            }
        };

        console.log('Scanning DynamoDB table with params:', params);

        const scanResult = await scan_dynamo(params);

        console.log('Scan result:', scanResult);

        if (!scanResult || !scanResult.Items) {
            console.error('No items found in scan result');
            throw new Error('No items found in scan result');
        }

        const stateSet = new Set();
        const uniqueStates = [];

        scanResult.Items.forEach(item => {
            const state = item.state;
            if (state && !stateSet.has(state)) {
                stateSet.add(state);
                uniqueStates.push(state);
            }
        });

        console.log('Unique states:', uniqueStates);

        console.log('Returning agent locations:', uniqueStates);

        return { Status: 'SUCCESS', Data: uniqueStates };
    }
    catch (error) {
        console.error('Error:', error);
        throw error;
    }
};





async function list_available_state_travelogues(event) {
    console.log("event", event);
    try {
        const available_tl_params = {
            TableName: "tl_travelogues",
            IndexName: "travelogue_Departure_country-travelogue_Departure_state-index",
            KeyConditionExpression: "travelogue_Departure_country = :travelogue_Departure_country",
            FilterExpression: "Approval_status = :Approval_status AND travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":Approval_status": "APPROVED",
                ":travelogue_status": "ACTIVE",
                ":travelogue_Departure_country": event.departure_country
            }
        };

        console.log("Query parameters:", available_tl_params);

        const result = await query_dynamo(available_tl_params);
        console.log("Query result:", result);

        // Group states by country
        const statesByCountry = {};
        result.Items.forEach(item => {
            const country = item.travelogue_Departure_country;
            if (!statesByCountry[country]) {
                statesByCountry[country] = [];
            }
            if (item.travelogue_Departure_state && !statesByCountry[country].includes(item.travelogue_Departure_state)) {
                statesByCountry[country].push(item.travelogue_Departure_state);
            }
        });

        return { Status: "Success", data: statesByCountry };
    }
    catch (error) {
        console.error("Error fetching data:", error);
        return { Status: "ERROR", Message: "An error occurred while fetching data: " + error.message };
    }
}




async function list_available_countries() {
    try {
        const available_country_params = {
            TableName: "tl_travelogues",
            ProjectionExpression: "travelogue_Departure_country",
            FilterExpression: "Approval_status = :Approval_status AND travelogue_status = :travelogue_status",
            ExpressionAttributeValues: {
                ":Approval_status": "APPROVED",
                ":travelogue_status": "ACTIVE"
            }
        };

        console.log("Params sent to DynamoDB:", available_country_params);

        const result = await scan_dynamo(available_country_params);

        console.log("Response from DynamoDB:", result);

        if (!result || !result.Items) {
            console.error("Error: Empty response from DynamoDB.");
            return [];
        }

        const countries = result.Items.reduce((acc, item) => {
            if (item && item.travelogue_Departure_country) {
                const country = item.travelogue_Departure_country;
                if (!acc.includes(country)) {
                    acc.push(country);
                }
            }
            return acc;
        }, []);

        return { Status: "Success!", Data: countries };
    }
    catch (error) {
        console.error("Error scanning DynamoDB:", error);
        return { Status: "Error", Message: "No countries available" + error.message };


    }
}


async function create_public_pov(event) {

    const insertUser = {
        TableName: "tl_user_pov_drafts",
        Item: {
            pov_id: uuidv4(),
            pov_name: event.pov_name,
            pov_description: event.pov_description,
            pov_created_on: Date.now(),
            pov_created_by: "App_user",
            pov_creator_name: "App_user",
            pov_status: "PENDING",
            pov_latitude: event.pov_latitude,
            pov_longitude: event.pov_longitude,
            post_url: []
        }
    }
    let result = await insert_into_dynamo(insertUser);
    console.log(result);
    if (result === "SUCCESS") {
        let mapping_user = {
            TableName: "tl_global_pov",
            Item: {
                pov_id: insertUser.Item.pov_id,
                pov_name: insertUser.Item.pov_name,
                pov_description: insertUser.Item.pov_description,
                pov_latitude: insertUser.Item.pov_latitude,
                pov_longitude: insertUser.Item.pov_longitude,
                pov_created_on: insertUser.Item.pov_created_on,
                created_by: "App_user",
                creator_user_type: "USER",
                creator_name: "App_user",
                pov_status: "PENDING",
                post_url: []
            }
        }
        result = await insert_into_dynamo(mapping_user);
        console.log("2 nd result", result);
        return { status: 200, pov_id: insertUser.Item.pov_id };
    }
}
// }


async function create_post(event) {
    let checkPov = {
        TableName: "tl_user_pov_drafts",
        KeyConditionExpression: " pov_id = :pov_id",
        ExpressionAttributeValues: {
            ":pov_id": event.pov_id
        }
    }

    let povExists = await query_dynamo(checkPov);
    console.log(povExists);
    if (povExists.Count > 0) {
        let uploadParams = {
            TableName: "pov_public_post_table",
            Item: {
                post_id: uuidv4(),
                pov_id: povExists.Items[0].pov_id,
                post_url: event.post_url
            }
        }
        let upload = await insert_into_dynamo(uploadParams);
        console.log(upload);
        if (upload === "SUCCESS") {
            let insertIntoGlobalPovTable = {
                TableName: "tl_user_pov_drafts",
                Key: {
                    pov_id: povExists.Items[0].pov_id,
                },
                UpdateExpression: 'SET post_url = list_append(post_url, :post_url)',
                ExpressionAttributeValues: {
                    ':post_url': [event.post_url],
                }
            }

            const result = await update_dynamo(insertIntoGlobalPovTable);
            if (result === "SUCCESS") {
                let insertIntoGlobalPovTable = {
                    TableName: "tl_global_pov",
                    Key: {
                        pov_id: povExists.Items[0].pov_id,
                    },
                    UpdateExpression: 'SET post_url = list_append(post_url, :post_url)',
                    ExpressionAttributeValues: {
                        ':post_url': [event.post_url],
                    }
                }

                const result = await update_dynamo(insertIntoGlobalPovTable);
                return { Status: 200, Message: "Post uploaded successfully" };
            }

        }

    }
}



async function list_global_posts(event) {
    const input = {
        TableName: "tl_global_pov",
        KeyConditionExpression: "pov_id = :pov_id",
        ExpressionAttributeValues: {
            ":pov_id": event.pov_id
        }
    }
    const povDetails = await query_dynamo(input);
    if (povDetails.Count > 0) {
        const postsUrl = povDetails.Items[0].post_url;
        return { Status: 200, data: postsUrl }
    }
    return { Message: `No Pov with ${event.pov_id} found!` }
}



async function send_device_details(event) {
    console.log("Event",event);

    const input = {
        TableName: "user_device_details",
        KeyConditionExpression: "device_id= :device_id",
        ExpressionAttributeValues: {
            ":device_id": event.device_id
        }
    }
    let response = await query_dynamo(input);
    console.log(response);
    if (response.Count == 0) {
        let insertDeviceDetails = {
            TableName: "user_device_details",
            Item: {
                device_id: event.device_id,
                os_type: event.os_type,
                version: event.version,
                details_fetched_on:Date.now()
            }
        }
         await insert_into_dynamo(insertDeviceDetails);
         return{status:200, message:"Device details recorded successfully!"}
    }
    if (response.Count > 0) {
        let updateExpression = "SET ";
        let expressionAttributeValues = {};

        if (event.os_type !== undefined) {
            updateExpression += "os_type = :os_type, ";
            expressionAttributeValues[":os_type"] = event.os_type;
        }

        if (event.version !== undefined) {
            updateExpression += "version = :version ";
            expressionAttributeValues[":version"] = event.version;
        }
        let updateParams = {
            TableName: "user_device_details",
            Key: {
                device_id: event.device_id
            },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues
        }
        let updation = await update_dynamo(updateParams);
        console.log(updation);
        if (updation === "SUCCESS") {
            return { status: 200, message: "Update successful!" }
        }
        else {
            return { message: "Updation failed!" }
        }
    }
}



export const handler = async (event) => {
    switch (event.command) {
        case "create_user":
            return await create_user(event);

        case "update_fcm_token":
            return await update_fcm_token(event);

        case "edit_user_profile":
            return await edit_user_profile(event);

        case "travelogue_creation":
            return await travelogue_creation(event);

        case "list_travelogues":
            return await list_travelogues(event);

        case "list_travelogues_of_user":
            return await list_travelogues_of_user(event);

        case "create_viewer":
            return await create_viewer(event);

        case "list_cotravellers":
            return await list_cotravellers(event);

        case "get_current_user":
            return await get_current_user(event);

        case "create_travelogue_subscription":
            return await create_travelogue_subscription(event);

        case "list_viewers":
            return await list_viewers(event);

        case "create_cotraveller":
            return await create_cotraveller(event);

        case "pov_creation":
            return await pov_creation(event);

        case "update_travelogue_details":
            return await update_travelogue_details(event);

        case "delete_cotraveller_viewer":
            return await delete_cotraveller_viewer(event);

        case "delete_account":
            return await delete_account(event);

        case "list_pov":
            return await list_pov(event);

        case "delete_pov":
            return await delete_pov(event);

        case "list_post":
            return await list_post(event);

        case "update_travelogue_status":
            return await update_travelogue_status(event);

        case "post_creation":
            return await post_creation(event);

        case "list_packages":
            return await list_packages(event);

        case "list_users":
            return await list_users(event);

        case "make_travelogue_public":
            return await make_travelogue_public(event);

        case "list_public_travelogues":
            return await list_public_travelogues(event);

        case "add_my_favorite_travelogues":
            return await add_my_favorite_travelogues(event);

        case "display_my_favorite_travelogues":
            return await display_my_favorite_travelogues(event);

        case "cancel_subscription":
            return await cancel_subscription(event);

        case "delete_post":
            return await delete_post(event);

        case "close_travelogue_status":
            return await close_travelogue_status(event);

        case "edit_pov":
            return await edit_pov(event);

        case "list_travelog_by_id":
            return await list_travelog_by_id(event);

        case "delete_travelogue_status":
            return await delete_travelogue_status(event);

        case "list_my_subscriptions":
            return await list_my_subscriptions(event);

        case "get_travelog_subscriptions":
            return await get_travelog_subscriptions(event);

        case "delete_cotraveller":
            return await delete_cotraveller(event);

        case "delete_viewer":
            return await delete_viewer(event);

        case "get_agent":
            return await get_agent(event);

        case "display_featured_travelogues":
            return await display_featured_travelogues(event);

        case "travelogS3URL":
            return await travelogS3URL(event);

        case "travelogS3URL_for_download":
            return await travelogS3URL_for_download(event);

        case "list_agent_locations":
            return await list_agent_locations(event);

        case "list_available_state_travelogues":
            return await list_available_state_travelogues(event);

        case "list_available_countries":
            return await list_available_countries();

        case "create_public_pov":
            return await create_public_pov(event);

        case "create_post":
            return await create_post(event);

        case "list_global_posts":
            return await list_global_posts(event);

        case "send_device_details":
            return await send_device_details(event);

        default:
            throw new Error("Command Not Found!");


    }
};
