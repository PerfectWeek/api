import {Column, Entity, Index, PrimaryGeneratedColumn} from "typeorm";
import { Encrypt } from "../../utils/encrypt";
import { ApiException } from "../../utils/apiException";

@Entity("PendingUser")
export class PendingUser {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({length: 31})
    @Index({unique: true})
    pseudo: string;

    @Column()
    @Index({unique: true})
    email: string;

    @Column({name: "ciphered_password"})
    cipheredPassword: string;

    @Column()
    @Index({unique: true})
    validationUuid: string;

    @Column({name: "created_at", type: "timestamp with time zone", default: () => "CURRENT_TIMESTAMP"})
    createdAt: Date;

    @Column({name: "updated_at", type: "timestamp with time zone", default: () => "CURRENT_TIMESTAMP"})
    updatedAt: Date;


    public constructor(pseudo: string, email: string, ciphered_password: string, validation_uuid: string) {
        this.pseudo = pseudo;
        this.email = email;
        this.cipheredPassword = ciphered_password
        this.validationUuid = validation_uuid;

    }

    // Validators
    private static pseudo_regex = new RegExp(/^[a-zA-Z0-9_-]{2,31}$/);
    private static email_regex = new RegExp(/\w+(?:\.\w+)*@\w+(?:\.\w+)+/);

    //
    // Check if a User satisfies the basic rules (pseudo format, email format, ...)
    //
    public isValid() : boolean {
        return PendingUser.pseudo_regex.test(this.pseudo)
            && PendingUser.email_regex.test(this.email);
    }

    //
    // Check if the given password is valid for this User
    //
    public async checkPassword(password: string): Promise<boolean> {
        return await Encrypt.matchPassword(password, this.cipheredPassword);
    }

    //
    // Cipher the given password
    //
    public static async cipherPassword(password: string) : Promise<string> {
        if (password.length < 8)
            throw new ApiException(403, "Password must be at least 8 characters long");
        return Encrypt.hashPassword(password);
    }
}
